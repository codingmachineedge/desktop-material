import assert from 'node:assert'
import { describe, it } from 'node:test'
import * as React from 'react'

import { Repository } from '../../../src/models/repository'
import { PopupType } from '../../../src/models/popup'
import { ShowBranchNameInRepoListSetting } from '../../../src/models/show-branch-name-in-repo-list'
import { Dispatcher } from '../../../src/ui/dispatcher'
import { RepositoriesList } from '../../../src/ui/repositories-list/repositories-list'
import { fireEvent, render, screen } from '../../helpers/ui/render'

class TestResizeObserver {
  public observe() {}
  public unobserve() {}
  public disconnect() {}
}

Object.defineProperty(globalThis, 'ResizeObserver', {
  configurable: true,
  value: TestResizeObserver,
})
Object.defineProperty(window, 'ResizeObserver', {
  configurable: true,
  value: TestResizeObserver,
})

const localRepository = new Repository('/work/local-repo', 1, null, false)

function createProps(showPopup: (popup: { type: PopupType }) => void) {
  const dispatcher = {
    closeFoldout: () => undefined,
    recordRepoClicked: () => undefined,
    showPopup,
  } as unknown as Dispatcher

  return {
    selectedRepository: null,
    repositories: [localRepository],
    recentRepositories: [],
    showRecentRepositories: true,
    showBranchNameInRepoList: ShowBranchNameInRepoListSetting.Never,
    localRepositoryStateLookup: new Map(),
    onSelectionChanged: () => undefined,
    askForConfirmationOnRemoveRepository: false,
    onRemoveRepository: () => undefined,
    onShowRepository: () => undefined,
    onViewOnGitHub: () => undefined,
    onOpenInNewWindow: () => undefined,
    onOpenInShell: () => undefined,
    onOpenInExternalEditor: () => undefined,
    onFilterTextChanged: () => undefined,
    filterText: '',
    dispatcher,
    accounts: [],
  }
}

describe('RepositoriesList batch actions', () => {
  it('renders both the Pull all and Commit & push all buttons', () => {
    render(<RepositoriesList {...createProps(() => {})} />)

    assert.ok(screen.getByRole('button', { name: /Pull all/ }))
    assert.ok(screen.getByRole('button', { name: /Commit & push all/ }))
  })

  it('opens the Commit and push all popup when the button is clicked', () => {
    const popups: Array<{ type: PopupType }> = []
    render(<RepositoriesList {...createProps(popup => popups.push(popup))} />)

    fireEvent.click(screen.getByRole('button', { name: /Commit & push all/ }))

    assert.equal(popups.length, 1)
    assert.equal(popups[0].type, PopupType.CommitAndPushAll)
  })
})
