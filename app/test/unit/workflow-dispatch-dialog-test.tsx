import assert from 'node:assert'
import { beforeEach, describe, it } from 'node:test'
import * as React from 'react'

import {
  WorkflowDispatchDialog,
  WorkflowDispatchPickerSearchSurfaceId,
} from '../../src/ui/actions/workflow-dispatch-dialog'
import { IAPIWorkflow } from '../../src/lib/api'
import { Repository } from '../../src/models/repository'
import { ActionsStore } from '../../src/lib/stores/actions-store'
import { SearchSurfaceRegistry } from '../../src/lib/collection-surface-registry'
import {
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from '../helpers/ui/render'

// Language and filter-mode state leak through localStorage between suites, so
// reset both before each assertion runs.
beforeEach(() => {
  localStorage.removeItem('language-mode-v1')
  localStorage.removeItem(
    `filter-mode/${WorkflowDispatchPickerSearchSurfaceId}`
  )
})

function workflow(
  id: number,
  name: string,
  file: string,
  state: IAPIWorkflow['state'] = 'active'
): IAPIWorkflow {
  return {
    id,
    name,
    path: `.github/workflows/${file}`,
    state,
    html_url: `https://example.com/${file}`,
    created_at: '2024-01-01T00:00:00Z',
    updated_at: '2024-01-01T00:00:00Z',
  }
}

const workflows: ReadonlyArray<IAPIWorkflow> = [
  workflow(1, 'Build installers', 'build-installers.yml'),
  workflow(2, 'CI', 'ci.yml'),
  workflow(3, 'CodeQL', 'codeql.yml', 'disabled_manually'),
]

const repository = new Repository('C:/dispatch', 1, null, false)

function fakeActionsStore(): ActionsStore {
  return {
    fetchWorkflowSource: async () => 'on:\n  workflow_dispatch:\n',
  } as unknown as ActionsStore
}

function renderDialog(
  overrides: Partial<React.ComponentProps<typeof WorkflowDispatchDialog>> = {}
) {
  const onSubmit = overrides.onSubmit ?? (async () => undefined)
  return {
    onSubmit,
    ...render(
      <WorkflowDispatchDialog
        repository={repository}
        workflows={workflows}
        initialWorkflowId={1}
        branchNames={['main']}
        initialRef="main"
        actionsStore={fakeActionsStore()}
        onSubmit={onSubmit}
        onDismissed={() => undefined}
        {...overrides}
      />
    ),
  }
}

async function cycleFilterMode(times: number) {
  for (let i = 0; i < times; i++) {
    const button = screen.getByRole('button', {
      name: /Filter mode: .+ \(click to change\)/,
    })
    fireEvent.click(button)
  }
}

describe('WorkflowDispatchDialog workflow picker', () => {
  it('registers its search surface id', () => {
    const entry = SearchSurfaceRegistry.find(
      surface => surface.id === WorkflowDispatchPickerSearchSurfaceId
    )
    assert.ok(entry, 'workflow dispatch picker must be registered')
    assert.strictEqual(entry?.implementation, 'standalone')
  })

  it('renders a searchable list box of every workflow', () => {
    renderDialog()
    const listbox = screen.getByRole('listbox')
    assert.ok(listbox)
    assert.ok(screen.getByRole('searchbox'))
    assert.strictEqual(screen.getAllByRole('option').length, workflows.length)
  })

  it('exposes each row filename detail', () => {
    renderDialog()
    assert.ok(screen.getByText('ci.yml'))
    assert.ok(screen.getByText('build-installers.yml'))
    assert.ok(screen.getByText('codeql.yml'))
  })

  it('narrows the rows with a substring filter', async () => {
    renderDialog()
    await cycleFilterMode(1) // Fuzzy -> Substring
    fireEvent.change(screen.getByRole('searchbox'), { target: { value: 'ci' } })
    await waitFor(() => {
      assert.strictEqual(screen.getAllByRole('option').length, 1)
    })
    assert.ok(screen.getByText('ci.yml'))
    assert.ok(screen.getByText('CI'))
  })

  it('narrows the rows with a regex filter', async () => {
    renderDialog()
    await cycleFilterMode(2) // Fuzzy -> Substring -> Regex
    fireEvent.change(screen.getByRole('searchbox'), {
      target: { value: '^codeql' },
    })
    await waitFor(() => {
      assert.strictEqual(screen.getAllByRole('option').length, 1)
    })
    assert.ok(screen.getByText('codeql.yml'))
  })

  it('shows an empty state when nothing matches', async () => {
    renderDialog()
    await cycleFilterMode(1) // Substring
    fireEvent.change(screen.getByRole('searchbox'), {
      target: { value: 'no-such-workflow' },
    })
    await waitFor(() => {
      assert.strictEqual(screen.queryAllByRole('option').length, 0)
    })
    assert.ok(screen.getByText(/No workflows match/i))
  })

  it('selecting a row updates the selection used by Run workflow', async () => {
    const submitted: Array<number> = []
    renderDialog({
      onSubmit: async workflowId => {
        submitted.push(workflowId)
      },
    })

    // The row for CI (id 2) is not the initial selection (id 1).
    const ciRow = screen.getByText('ci.yml').closest('[role="option"]')
    assert.ok(ciRow)
    fireEvent.click(ciRow as HTMLElement)

    assert.strictEqual(
      (ciRow as HTMLElement).getAttribute('aria-selected'),
      'true'
    )

    const runButton = await screen.findByRole('button', {
      name: 'Run workflow',
    })
    await waitFor(() => assert.ok(!(runButton as HTMLButtonElement).disabled))
    fireEvent.click(runButton)

    await waitFor(() => assert.deepStrictEqual(submitted, [2]))
  })

  it('moves the selection with arrow keys', () => {
    renderDialog()
    const listbox = screen.getByRole('listbox')
    fireEvent.keyDown(listbox, { key: 'ArrowDown' })
    const selected = screen
      .getAllByRole('option')
      .find(option => option.getAttribute('aria-selected') === 'true')
    assert.ok(selected)
    // Initial selection was id 1 (Build installers); ArrowDown moves to id 2.
    assert.ok(within(selected as HTMLElement).getByText('ci.yml'))
  })
})
