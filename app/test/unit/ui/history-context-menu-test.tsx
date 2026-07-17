import assert from 'node:assert'
import { describe, it } from 'node:test'
import * as React from 'react'

import { IMenuItem } from '../../../src/lib/menu-item'
import { Commit } from '../../../src/models/commit'
import { CommitIdentity } from '../../../src/models/commit-identity'
import {
  CommitList,
  getEffectiveCommitSelection,
} from '../../../src/ui/history/commit-list'
import { CommitListItem } from '../../../src/ui/history/commit-list-item'
import { ListRow } from '../../../src/ui/lib/list/list-row'
import { fireEvent, render, screen } from '../../helpers/ui/render'

const identity = new CommitIdentity('Test', 'test@example.com', new Date(0))

function makeCommit(sha: string, summary = sha) {
  return new Commit(sha, sha, summary, '', identity, identity, [], [], [])
}

function makeCommitList(
  commits: ReadonlyArray<Commit>,
  selectedSHAs: ReadonlyArray<string>,
  overrides: Record<string, unknown> = {}
) {
  return new CommitList({
    gitHubRepository: null,
    commitSHAs: commits.map(commit => commit.sha),
    commitLookup: new Map(commits.map(commit => [commit.sha, commit])),
    selectedSHAs,
    emoji: new Map(),
    localCommitSHAs: commits.map(commit => commit.sha),
    isLocalRepository: true,
    accounts: [],
    preferAbsoluteDates: false,
    isMultiCommitOperationInProgress: false,
    ...overrides,
  })
}

describe('history contextual actions', () => {
  it('preserves a multi-selection only when the invoked commit belongs to it', () => {
    const first = makeCommit('first')
    const second = makeCommit('second')
    const third = makeCommit('third')
    const lookup = new Map(
      [first, second, third].map(commit => [commit.sha, commit])
    )

    assert.deepEqual(
      getEffectiveCommitSelection(first, ['first', 'second'], lookup),
      [first, second]
    )
    assert.deepEqual(
      getEffectiveCommitSelection(third, ['first', 'second'], lookup),
      [third]
    )
  })

  it('uses only the clicked commit for single cherry-pick and gates branch creation', () => {
    const clicked = makeCommit('clicked')
    const stale = makeCommit('stale')
    const cherryPicked = new Array<ReadonlyArray<Commit>>()
    const list = makeCommitList([clicked, stale], [stale.sha], {
      onCherryPick: (commits: ReadonlyArray<Commit>) =>
        cherryPicked.push(commits),
    })
    const testable = list as unknown as {
      getContextMenuForSingleCommit(row: number, commit: Commit): IMenuItem[]
    }

    const items = testable.getContextMenuForSingleCommit(0, clicked)
    items.find(item => item.label?.startsWith('Cherry-pick'))?.action?.()

    assert.deepEqual(cherryPicked, [[clicked]])
    assert.equal(
      items.find(item =>
        item.label?.toLocaleLowerCase().startsWith('create branch')
      )?.enabled,
      false
    )
  })

  it('marks specialized rows and opens them with both keyboard menu gestures', () => {
    let regularKeyDowns = 0
    let menuRequests = 0

    render(
      <ListRow
        sectionHasHeader={false}
        rowCount={1}
        rowIndex={{ section: 0, row: 0 }}
        inKeyboardInsertionMode={false}
        onRowMouseDown={() => {}}
        onRowMouseUp={() => {}}
        onRowClick={() => {}}
        onRowDoubleClick={() => {}}
        onRowKeyDown={() => regularKeyDowns++}
        onKeyboardContextMenu={() => menuRequests++}
        selectable={true}
        hasKeyboardFocus={false}
      >
        Commit row
      </ListRow>
    )

    const row = screen.getByRole('option')
    assert.equal(row.getAttribute('data-context-menu-owner'), 'true')
    assert.equal(row.getAttribute('aria-haspopup'), 'menu')
    assert.equal(fireEvent.keyDown(row, { key: 'F10', shiftKey: true }), false)
    assert.equal(fireEvent.keyDown(row, { key: 'ContextMenu' }), false)
    assert.equal(menuRequests, 2)
    assert.equal(regularKeyDowns, 0)
  })

  it('does not claim contextual-menu ownership without a specialized handler', () => {
    render(
      <ListRow
        sectionHasHeader={false}
        rowCount={1}
        rowIndex={{ section: 0, row: 0 }}
        inKeyboardInsertionMode={false}
        onRowMouseDown={() => {}}
        onRowMouseUp={() => {}}
        onRowClick={() => {}}
        onRowDoubleClick={() => {}}
        onRowKeyDown={() => {}}
        selectable={true}
        hasKeyboardFocus={false}
      >
        Plain row
      </ListRow>
    )

    const row = screen.getByRole('option')
    assert.equal(row.getAttribute('data-context-menu-owner'), null)
    assert.equal(row.getAttribute('aria-haspopup'), null)
  })

  it('offers the same More actions entry point for a commit row', () => {
    const commit = makeCommit('abc123', 'Document the API')
    let menuRequests = 0

    render(
      <CommitListItem
        gitHubRepository={null}
        commit={commit}
        selectedCommits={[commit]}
        emoji={new Map()}
        showUnpushedIndicator={false}
        accounts={[]}
        preferAbsoluteDates={false}
        onShowContextMenu={() => menuRequests++}
      />
    )

    fireEvent.click(
      screen.getByRole('button', {
        name: 'More actions for Document the API',
      })
    )
    assert.equal(menuRequests, 1)
  })
})
