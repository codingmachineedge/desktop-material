import { describe, it } from 'node:test'
import assert from 'node:assert'
import * as React from 'react'

import {
  describeManagedStashError,
  groupManagedStashes,
  StashManager,
} from '../../../src/ui/stashing/stash-manager'
import {
  IStashEntry,
  StashedChangesLoadStates,
} from '../../../src/models/stash-entry'
import { Repository } from '../../../src/models/repository'
import { WorkingDirectoryStatus } from '../../../src/models/status'
import { Dispatcher } from '../../../src/ui/dispatcher'
import { StashManagerError } from '../../../src/lib/git/stash'
import { fireEvent, render, screen, waitFor } from '../../helpers/ui/render'
import { LanguageModeChangedEvent } from '../../../src/lib/i18n'

const mainEntry: IStashEntry = {
  name: 'refs/stash@{0}',
  branchName: 'main',
  stashSha: 'a'.repeat(40),
  displayName: 'Main review',
  createdAt: '2026-07-13T12:00:00.000Z',
  tree: 'b'.repeat(40),
  parents: ['c'.repeat(40)],
  files: { kind: StashedChangesLoadStates.NotLoaded },
}

const featureEntry: IStashEntry = {
  name: 'refs/stash@{1}',
  branchName: 'feature/long-lived-work',
  stashSha: 'd'.repeat(40),
  displayName: 'Feature review',
  createdAt: '2026-07-12T12:00:00.000Z',
  tree: 'e'.repeat(40),
  parents: ['f'.repeat(40)],
  files: { kind: StashedChangesLoadStates.NotLoaded },
}

const externalEntry: IStashEntry = {
  name: 'refs/stash@{2}',
  branchName: 'main',
  stashSha: '1'.repeat(40),
  displayName: 'CLI checkpoint',
  createdAt: '2026-07-11T12:00:00.000Z',
  origin: 'external',
  tree: '2'.repeat(40),
  parents: ['3'.repeat(40)],
  files: { kind: StashedChangesLoadStates.NotLoaded },
}

class FakeStashDispatcher {
  public readonly creates: unknown[] = []
  public readonly selected: IStashEntry[] = []
  public readonly applied: IStashEntry[] = []
  public readonly restored: IStashEntry[] = []
  public readonly cleared: ReadonlyArray<string>[] = []
  public readonly updates: unknown[] = []
  public readonly branches: string[] = []

  public createManagedStash = async (
    _repository: Repository,
    request: unknown,
    _signal?: AbortSignal
  ) => {
    this.creates.push(request)
    return true
  }

  public selectStashedFile = async (
    _repository: Repository,
    stashEntry: IStashEntry
  ) => {
    this.selected.push(stashEntry)
  }

  public selectWorkingDirectoryFiles = async () => {}
  public incrementMetric = () => {}

  public applyStashKeepingEntry = async (
    _repository: Repository,
    stashEntry: IStashEntry
  ) => {
    this.applied.push(stashEntry)
  }

  public popStash = async (
    _repository: Repository,
    stashEntry: IStashEntry
  ) => {
    this.restored.push(stashEntry)
  }

  public clearReviewedManagedStashes = async (
    _repository: Repository,
    stashShas: ReadonlyArray<string>
  ) => {
    this.cleared.push(stashShas)
    return stashShas.length
  }

  public updateManagedStash = async (
    _repository: Repository,
    _stashEntry: IStashEntry,
    request: unknown
  ) => {
    this.updates.push(request)
  }

  public createBranchFromManagedStash = async (
    _repository: Repository,
    _stashEntry: IStashEntry,
    branchName: string
  ) => {
    this.branches.push(branchName)
  }
}

function renderManager(
  fake = new FakeStashDispatcher(),
  entries: ReadonlyArray<IStashEntry> = [featureEntry, mainEntry]
) {
  const repository = new Repository('C:\\repo', 1, null, false)
  render(
    <StashManager
      repository={repository}
      dispatcher={fake as unknown as Dispatcher}
      branch="main"
      workingDirectory={WorkingDirectoryStatus.fromFiles([])}
      selectedFileIDs={[]}
      allStashEntries={entries}
      foreignStashEntryCount={2}
      stashInventoryTruncated={false}
      selectedStashEntry={null}
      isShowingStashEntry={false}
      hasConflicts={false}
    />
  )
  return fake
}

describe('stash manager', () => {
  it('groups the current branch first without losing repository entries', () => {
    const groups = groupManagedStashes([featureEntry, mainEntry], 'main')
    assert.deepEqual(
      groups.map(group => [group.branchName, group.isCurrentBranch]),
      [
        ['main', true],
        ['feature/long-lived-work', false],
      ]
    )
    assert.equal(groups.flatMap(group => group.entries).length, 2)
  })

  it('renders a compact summary then exposes accessible all-branch inventory', () => {
    renderManager()
    assert(screen.getByText('2 repository stashes'))
    assert(screen.getByText('1 on main'))

    fireEvent.click(screen.getByRole('button', { name: 'Manage' }))

    assert(screen.getByRole('region', { name: 'Managed stash controls' }))
    assert(screen.getByText('Main review'))
    assert(screen.getByText('Feature review'))
    assert(screen.getByText('Current'))
    assert(screen.getByText(/2 external Git stashes are shown/))
  })

  it('shows external stashes with safe actions but no metadata rewrite', () => {
    renderManager(new FakeStashDispatcher(), [externalEntry])
    fireEvent.click(screen.getByRole('button', { name: 'Manage' }))
    assert(screen.getByText('External'))
    fireEvent.click(screen.getByRole('button', { name: /CLI checkpoint/ }))
    assert(screen.getByRole('button', { name: 'Apply copy' }))
    assert(screen.getByRole('button', { name: 'Restore' }))
    assert(screen.getByRole('button', { name: 'New branch' }))
    assert(screen.getByRole('button', { name: 'Discard' }))
    assert(screen.queryByRole('button', { name: 'Rename or move' }) === null)
  })

  it('creates a named all-changes stash without exposing command arguments', async () => {
    const fake = renderManager()
    fireEvent.click(screen.getByRole('button', { name: 'Manage' }))
    fireEvent.change(screen.getByLabelText('Name'), {
      target: { value: 'Review before refactor' },
    })
    fireEvent.click(screen.getByRole('button', { name: 'Create named stash' }))

    await waitFor(() => assert.equal(fake.creates.length, 1))
    assert.deepEqual(fake.creates[0], {
      displayName: 'Review before refactor',
      includeUntracked: false,
      scope: 'all',
      selectedPaths: [],
    })
    assert(
      screen.queryByText(/stash push|--include-untracked|refs\/stash/) === null
    )
  })

  it('supports apply-keep and confirms restore before consuming a stash', async () => {
    const fake = renderManager()
    fireEvent.click(screen.getByRole('button', { name: 'Manage' }))
    fireEvent.click(screen.getByRole('button', { name: /Main review/ }))
    fireEvent.click(screen.getByRole('button', { name: 'Apply copy' }))
    await waitFor(() => assert.equal(fake.applied.length, 1))

    fireEvent.click(screen.getByRole('button', { name: 'Restore' }))
    assert(screen.getByText(/removes the stash only if Git finishes cleanly/))
    fireEvent.click(screen.getByRole('button', { name: 'Confirm' }))
    await waitFor(() => assert.equal(fake.restored.length, 1))
  })

  it('clears only checked managed identities after an explicit review', async () => {
    const fake = renderManager()
    fireEvent.click(screen.getByRole('button', { name: 'Manage' }))
    fireEvent.click(
      screen.getByRole('checkbox', {
        name: 'Review Main review for stash clear',
      })
    )
    fireEvent.click(screen.getByRole('button', { name: 'Clear reviewed (1)' }))
    assert(screen.getByText(/Only the exact checked identities are included/))
    fireEvent.click(screen.getByRole('button', { name: 'Confirm' }))

    await waitFor(() => assert.equal(fake.cleared.length, 1))
    assert.deepEqual(fake.cleared[0], [mainEntry.stashSha])
  })

  it('reviews metadata updates and branch creation through task-specific forms', async () => {
    const fake = renderManager()
    fireEvent.click(screen.getByRole('button', { name: 'Manage' }))
    fireEvent.click(screen.getByRole('button', { name: /Main review/ }))

    fireEvent.click(screen.getByRole('button', { name: 'Rename or move' }))
    fireEvent.change(
      screen.getByLabelText('Name', {
        selector: '#desktop-material-stash-metadata-name',
      }),
      {
        target: { value: 'Renamed review' },
      }
    )
    fireEvent.change(screen.getByLabelText('Branch association'), {
      target: { value: 'feature/moved' },
    })
    fireEvent.click(screen.getByRole('button', { name: 'Save details' }))
    await waitFor(() => assert.equal(fake.updates.length, 1))
    assert.deepEqual(fake.updates[0], {
      displayName: 'Renamed review',
      branchName: 'feature/moved',
    })

    fireEvent.click(screen.getByRole('button', { name: /Main review/ }))
    fireEvent.click(screen.getByRole('button', { name: 'New branch' }))
    fireEvent.change(screen.getByLabelText('New local branch'), {
      target: { value: 'recovery/main-review' },
    })
    fireEvent.click(
      screen.getByRole('button', { name: 'Review branch creation' })
    )
    fireEvent.click(screen.getByRole('button', { name: 'Create branch' }))
    await waitFor(() =>
      assert.deepEqual(fake.branches, ['recovery/main-review'])
    )
  })

  it('aborts the exact in-flight operation from the sticky busy control', async () => {
    const fake = new FakeStashDispatcher()
    let aborted = false
    fake.createManagedStash = async (
      _repository: Repository,
      _request: unknown,
      signal?: AbortSignal
    ) => {
      await new Promise<void>((_resolve, reject) => {
        signal?.addEventListener(
          'abort',
          () => {
            aborted = true
            reject(new StashManagerError('aborted', 'cancelled'))
          },
          { once: true }
        )
      })
      return false
    }
    renderManager(fake)
    fireEvent.click(screen.getByRole('button', { name: 'Manage' }))
    fireEvent.change(screen.getByLabelText('Name'), {
      target: { value: 'Long operation' },
    })
    fireEvent.click(screen.getByRole('button', { name: 'Create named stash' }))
    fireEvent.click(screen.getByRole('button', { name: 'Cancel operation' }))

    await waitFor(() => assert.equal(aborted, true))
    assert(
      screen.getByText(
        'Creating named stash cancelled. The repository was refreshed.'
      )
    )
  })

  it('turns cancellation and Git failures into bounded recovery guidance', () => {
    assert.equal(
      describeManagedStashError(
        new StashManagerError('aborted', 'ignored'),
        'Restore',
        true
      ),
      'Restore cancelled. The repository was refreshed.'
    )
    assert.match(
      describeManagedStashError(new Error('secret argv'), 'Restore', false),
      /stash was kept whenever restore was not clean/
    )
    assert.doesNotMatch(
      describeManagedStashError(new Error('secret argv'), 'Restore', false),
      /secret argv/
    )
  })

  it('live-switches external actions and an existing operation status', async () => {
    localStorage.setItem(
      'appearance-customization-v1',
      JSON.stringify({ version: 1, languageMode: 'english' })
    )
    const fake = new FakeStashDispatcher()
    const repository = new Repository('C:\\repo', 1, null, false)
    const view = render(
      <StashManager
        repository={repository}
        dispatcher={fake as unknown as Dispatcher}
        branch="main"
        workingDirectory={WorkingDirectoryStatus.fromFiles([])}
        selectedFileIDs={[]}
        allStashEntries={[externalEntry]}
        foreignStashEntryCount={1}
        stashInventoryTruncated={false}
        selectedStashEntry={null}
        isShowingStashEntry={false}
        hasConflicts={false}
      />
    )

    try {
      fireEvent.click(screen.getByRole('button', { name: 'Manage' }))
      fireEvent.click(screen.getByRole('button', { name: /CLI checkpoint/ }))
      fireEvent.change(screen.getByLabelText('Name'), {
        target: { value: 'Localized checkpoint' },
      })
      fireEvent.click(
        screen.getByRole('button', { name: 'Create named stash' })
      )
      await screen.findByText(
        'Named stash created. It is available under its recorded branch.'
      )

      document.dispatchEvent(
        new CustomEvent(LanguageModeChangedEvent, { detail: 'cantonese' })
      )
      await waitFor(() => assert.ok(screen.getByText('外部')))
      assert.ok(screen.getByRole('button', { name: '套用副本' }))
      assert.ok(
        screen.getByText('命名 stash 已建立，並已放喺記錄咗嘅分支下面。')
      )

      document.dispatchEvent(
        new CustomEvent(LanguageModeChangedEvent, { detail: 'bilingual' })
      )
      await waitFor(() =>
        assert.match(view.container.textContent ?? '', /External · 外部/)
      )
    } finally {
      view.unmount()
      localStorage.removeItem('appearance-customization-v1')
    }
  })
})
