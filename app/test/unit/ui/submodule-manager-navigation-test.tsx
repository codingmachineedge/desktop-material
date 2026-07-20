import assert from 'node:assert'
import { afterEach, beforeEach, describe, it } from 'node:test'
import * as React from 'react'

import { IManagedSubmodule } from '../../../src/lib/git'
import { translate, translateForAccessibleName } from '../../../src/lib/i18n'
import { LanguageModeStorageKey } from '../../../src/lib/language-preference'
import { PopupManager } from '../../../src/lib/popup-manager'
import { PopupType } from '../../../src/models/popup'
import { Repository } from '../../../src/models/repository'
import {
  DefaultAppearanceCustomization,
  IAppearanceCustomization,
} from '../../../src/models/appearance-customization'
import { Dispatcher } from '../../../src/ui/dispatcher'
import { Submodules } from '../../../src/ui/repository-settings/submodules'
import { SubmoduleManagerDialog } from '../../../src/ui/submodules/submodule-manager-dialog'
import {
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from '../../helpers/ui/render'

function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>(resolvePromise => {
    resolve = resolvePromise
  })
  return { promise, resolve }
}

const parent = new Repository('C:/fixtures/parent', 17, null, false)
let restoreIpcSend: (() => void) | null = null
let restoreDialogShow: (() => void) | null = null

beforeEach(async () => {
  const electron = await import('electron')
  const previousSend = electron.ipcRenderer.send
  electron.ipcRenderer.send = () => undefined
  restoreIpcSend = () => {
    electron.ipcRenderer.send = previousSend
    restoreIpcSend = null
  }

  const prototype = window.HTMLDialogElement.prototype
  const previousShow = prototype.show
  prototype.show = function () {
    this.setAttribute('open', '')
  }
  restoreDialogShow = () => {
    prototype.show = previousShow
    restoreDialogShow = null
  }
})

const cloned: IManagedSubmodule = {
  name: 'library',
  path: 'vendor/library',
  url: 'https://example.invalid/library.git',
  branch: 'main',
  update: null,
  ignore: null,
  shallow: null,
  fetchRecurseSubmodules: null,
  sha: '1111111111111111111111111111111111111111',
  describe: null,
  status: 'up-to-date',
}

const uninitialized: IManagedSubmodule = {
  ...cloned,
  name: 'docs',
  path: 'vendor/docs',
  sha: null,
  status: 'uninitialized',
}

const clonedSibling: IManagedSubmodule = {
  ...cloned,
  name: 'shared',
  path: 'vendor/shared',
  url: 'https://example.invalid/shared.git',
  sha: '2222222222222222222222222222222222222222',
}

afterEach(() => {
  restoreIpcSend?.()
  restoreDialogShow?.()
  localStorage.removeItem(LanguageModeStorageKey)
  localStorage.removeItem('appearance-customization-v1')
})

describe('Submodule Manager temporary repository navigation', () => {
  it('localizes summary, status, search, filters, and uncloned guidance', async () => {
    const dispatcher = {
      getSubmodules: async () => [cloned, uninitialized],
    } as unknown as Dispatcher

    localStorage.setItem(LanguageModeStorageKey, 'cantonese')
    const cantoneseView = render(
      <Submodules
        repository={parent}
        dispatcher={dispatcher}
        onRepositoryOpened={() => undefined}
      />
    )

    await screen.findByText('2 個子模組')
    assert.ok(screen.getByText('1 個已複製'))
    assert.ok(screen.getByText('1 個未複製'))
    assert.ok(screen.getByText('已經最新'))
    assert.ok(screen.getByText('未初始化'))
    assert.equal(
      screen.getByLabelText('搜尋子模組').getAttribute('placeholder'),
      '用名稱、路徑或者 URL 搵子模組'
    )
    assert.ok(screen.getByRole('group', { name: '按狀態篩選子模組' }))
    assert.ok(screen.getByRole('button', { name: '全部' }))
    assert.ok(screen.getByRole('button', { name: '未複製' }))
    assert.ok(screen.getByRole('button', { name: '未追到最新' }))
    assert.ok(screen.getByRole('button', { name: '有衝突' }))
    assert.ok(screen.getByRole('button', { name: '複製' }))
    assert.ok(screen.getByRole('button', { name: '新增子模組…' }))
    assert.ok(screen.getByRole('button', { name: '全部更新' }))
    assert.equal(screen.getAllByRole('button', { name: '同步' }).length, 2)
    assert.equal(screen.getAllByRole('button', { name: '設定' }).length, 2)
    assert.equal(screen.getAllByRole('button', { name: '移除' }).length, 2)
    assert.ok(
      screen.getByRole('button', {
        name: '打開並管理: vendor/docs',
      })
    )
    cantoneseView.unmount()

    localStorage.setItem(LanguageModeStorageKey, 'bilingual')
    const bilingualView = render(
      <Submodules
        repository={parent}
        dispatcher={dispatcher}
        onRepositoryOpened={() => undefined}
      />
    )

    await waitFor(() =>
      assert.match(
        bilingualView.container.querySelector('.submodules-summary')
          ?.textContent ?? '',
        /2 submodules · 2 個子模組/
      )
    )
    assert.match(
      bilingualView.container.querySelector('.submodules-summary')
        ?.textContent ?? '',
      /1 cloned · 1 個已複製.*1 not cloned · 1 個未複製/
    )
    assert.equal(
      bilingualView.container.querySelector('.submodule-status-uninitialized')
        ?.textContent,
      'Not initialized · 未初始化'
    )
    assert.ok(
      screen.getByRole('group', {
        name: 'Filter submodules by status',
      })
    )
    assert.ok(
      screen.getByRole('button', {
        name: 'Open & manage: vendor/docs',
      })
    )
    const sync = screen.getAllByRole('button', { name: 'Sync' })[0]
    assert.equal(sync.querySelector('[lang="en"]')?.textContent, 'Sync')
    assert.equal(sync.querySelector('[lang="zh-HK"]')?.textContent, '同步')
  })

  it('stages Back button appearance with a live temporary-workspace preview', async () => {
    const changes = new Array<IAppearanceCustomization>()
    const dispatcher = {
      getSubmodules: async () => [cloned],
    } as unknown as Dispatcher

    function AppearanceHarness() {
      const [appearance, setAppearance] =
        React.useState<IAppearanceCustomization>({
          ...DefaultAppearanceCustomization,
          submoduleBackButtonStyle: 'tonal',
          submoduleBackButtonLabel: 'back-to-parent',
        })

      return (
        <Submodules
          repository={parent}
          dispatcher={dispatcher}
          onRepositoryOpened={() => undefined}
          appearanceCustomization={appearance}
          onAppearanceCustomizationChanged={next => {
            changes.push(next)
            setAppearance(next)
          }}
        />
      )
    }

    const view = render(<AppearanceHarness />)
    await screen.findByText('vendor/library')

    assert.ok(
      screen.getByText(
        /opens the submodule temporarily.*never added to your repository list/i
      )
    )
    const preview = screen.getByRole('group', { name: 'Preview' })
    const previewButton = within(preview).getByRole('button', {
      name: 'Back to parent',
    })
    assert.equal(screen.queryByLabelText('Submodule Back button style'), null)

    fireEvent.contextMenu(previewButton)

    fireEvent.change(screen.getByLabelText('Submodule Back button style'), {
      target: { value: 'filled' },
    })
    fireEvent.change(screen.getByLabelText('Submodule Back button label'), {
      target: { value: 'parent-name' },
    })

    await waitFor(() => {
      assert.equal(changes.at(-1)?.submoduleBackButtonStyle, 'filled')
      assert.equal(changes.at(-1)?.submoduleBackButtonLabel, 'parent-name')
    })
    assert.ok(previewButton.classList.contains('submodule-context-back-filled'))
    assert.equal(
      previewButton.querySelector('.submodule-context-back-label')?.textContent,
      'parent'
    )

    view.unmount()
    render(
      <Submodules
        repository={parent}
        dispatcher={dispatcher}
        onRepositoryOpened={() => undefined}
        appearanceCustomization={{
          ...DefaultAppearanceCustomization,
          languageMode: 'cantonese',
        }}
        onAppearanceCustomizationChanged={() => undefined}
      />
    )
    assert.ok(
      await screen.findByRole('heading', {
        name: translate('submodule.appearanceHeading', 'cantonese'),
      })
    )
    const cantonesePreview = screen.getByRole('group', {
      name: translateForAccessibleName(
        'submodule.appearancePreview',
        {},
        'cantonese'
      ),
    })
    fireEvent.contextMenu(
      within(cantonesePreview).getByRole('button', {
        name: translateForAccessibleName(
          'submodule.backToParent',
          { parent: 'parent' },
          'cantonese'
        ),
      })
    )
    assert.ok(
      screen.getByLabelText(
        translate('appearance.submoduleBackStyle', 'cantonese')
      )
    )
    assert.ok(
      screen.getByLabelText(
        translate('appearance.submoduleBackLabel', 'cantonese')
      )
    )
  })

  it('localizes the standalone manager title and close action', async () => {
    localStorage.setItem(LanguageModeStorageKey, 'bilingual')
    const dispatcher = {
      getSubmodules: async () => [],
    } as unknown as Dispatcher

    const view = render(
      <SubmoduleManagerDialog
        repository={parent}
        dispatcher={dispatcher}
        onDismissed={() => undefined}
      />
    )

    await waitFor(() =>
      assert.match(
        view.container.querySelector('#submodule-manager-title')?.textContent ??
          '',
        /Submodule manager · 子模組管理/
      )
    )
    const close = view.container.querySelector(
      '.dialog-footer button[aria-label="Close"]'
    )
    assert.ok(close)
    assert.equal(close.querySelector('[lang="en"]')?.textContent, 'Close')
    assert.equal(close.querySelector('[lang="zh-HK"]')?.textContent, '關閉')
    view.unmount()
  })

  it('opens only a checked-out row and closes the manager after success', async () => {
    const opened: IManagedSubmodule[] = []
    let closeCount = 0
    const dispatcher = {
      getSubmodules: async () => [cloned, uninitialized],
      openSubmoduleAsRepository: async (
        repository: Repository,
        submodule: IManagedSubmodule
      ) => {
        assert.equal(repository, parent)
        opened.push(submodule)
      },
    } as unknown as Dispatcher

    render(
      <Submodules
        repository={parent}
        dispatcher={dispatcher}
        onRepositoryOpened={() => {
          closeCount++
        }}
      />
    )

    const openCloned = await screen.findByRole('button', {
      name: 'Open & manage: vendor/library',
    })
    const openUnavailable = screen.getByRole('button', {
      name: 'Open & manage: vendor/docs',
    })
    assert.equal(openCloned.getAttribute('aria-disabled'), null)
    assert.equal(openUnavailable.getAttribute('aria-disabled'), 'true')

    fireEvent.click(openUnavailable)
    assert.deepEqual(opened, [])
    assert.equal(closeCount, 0)

    fireEvent.click(openCloned)
    await waitFor(() => assert.equal(opened.length, 1))
    assert.equal(opened[0], cloned)
    assert.equal(closeCount, 1)
  })

  it('fences every dialog action while a temporary repository opens', async () => {
    const transition = deferred<void>()
    const opened: IManagedSubmodule[] = []
    let closeCount = 0
    let mutationCount = 0
    let popupCount = 0
    const dispatcher = {
      getSubmodules: async () => [cloned, clonedSibling, uninitialized],
      openSubmoduleAsRepository: async (
        repository: Repository,
        submodule: IManagedSubmodule
      ) => {
        assert.equal(repository, parent)
        opened.push(submodule)
        await transition.promise
      },
      updateSubmodules: async () => {
        mutationCount++
      },
      syncSubmodules: async () => {
        mutationCount++
      },
      removeSubmodule: async () => {
        mutationCount++
      },
      showPopup: () => {
        popupCount++
      },
    } as unknown as Dispatcher

    const view = render(
      <Submodules
        repository={parent}
        dispatcher={dispatcher}
        onRepositoryOpened={() => {
          closeCount++
        }}
      />
    )

    const sourceOpen = await screen.findByRole('button', {
      name: 'Open & manage: vendor/library',
    })
    const siblingOpen = screen.getByRole('button', {
      name: 'Open & manage: vendor/shared',
    })
    const add = screen.getByRole('button', { name: 'Add submodule…' })
    const updateAll = screen.getByRole('button', { name: 'Update all' })

    fireEvent.click(sourceOpen)

    await waitFor(() => {
      assert.equal(opened.length, 1)
      assert.equal(sourceOpen.getAttribute('aria-disabled'), 'true')
      assert.equal(siblingOpen.getAttribute('aria-disabled'), 'true')
      assert.equal(add.getAttribute('aria-disabled'), 'true')
      assert.equal(updateAll.getAttribute('aria-disabled'), 'true')
    })
    assert.equal(opened[0], cloned)

    const rowActions = Array.from(
      view.container.querySelectorAll<HTMLButtonElement>(
        '.submodule-row-actions button'
      )
    )
    assert.ok(rowActions.length > 0)
    for (const action of rowActions) {
      assert.equal(action.getAttribute('aria-disabled'), 'true')
      fireEvent.click(action)
    }
    fireEvent.click(add)
    fireEvent.click(updateAll)

    assert.equal(opened.length, 1)
    assert.equal(mutationCount, 0)
    assert.equal(popupCount, 0)
    assert.equal(closeCount, 0)

    transition.resolve()
    await waitFor(() => {
      assert.equal(closeCount, 1)
      assert.equal(siblingOpen.getAttribute('aria-disabled'), null)
      assert.equal(add.getAttribute('aria-disabled'), null)
      assert.equal(updateAll.getAttribute('aria-disabled'), null)
    })
  })

  it('does not close a later popup when the opening host was dismissed', async () => {
    const transition = deferred<void>()
    const popupManager = new PopupManager()
    const hostPopup = popupManager.addPopup({
      type: PopupType.SubmoduleManager,
      repository: parent,
    })
    assert.ok(hostPopup.id !== undefined)
    const hostPopupId = hostPopup.id
    let genericCloseCount = 0
    let ownerDismissCount = 0
    let operationCompleted = false
    const dispatcher = {
      getSubmodules: async () => [cloned],
      openSubmoduleAsRepository: async () => {
        await transition.promise
        operationCompleted = true
      },
      closePopup: () => {
        genericCloseCount++
        const currentPopup = popupManager.currentPopup
        if (currentPopup !== null) {
          popupManager.removePopup(currentPopup)
        }
      },
    } as unknown as Dispatcher

    const view = render(
      <Submodules
        repository={parent}
        dispatcher={dispatcher}
        onRepositoryOpened={() => {
          ownerDismissCount++
          popupManager.removePopupById(hostPopupId)
        }}
      />
    )
    fireEvent.click(
      await screen.findByRole('button', {
        name: 'Open & manage: vendor/library',
      })
    )

    popupManager.removePopupById(hostPopupId)
    view.unmount()
    const unrelatedPopup = popupManager.addPopup({ type: PopupType.About })

    transition.resolve()
    await waitFor(() => assert.equal(operationCompleted, true))
    await Promise.resolve()

    assert.equal(popupManager.currentPopup?.id, unrelatedPopup.id)
    assert.equal(genericCloseCount, 0)
    assert.equal(ownerDismissCount, 0)
  })

  it('keeps the manager open and presents a bounded error when open fails', async () => {
    let closeCount = 0
    const dispatcher = {
      getSubmodules: async () => [cloned],
      openSubmoduleAsRepository: async () => {
        throw new Error('child repository is stale')
      },
    } as unknown as Dispatcher

    render(
      <Submodules
        repository={parent}
        dispatcher={dispatcher}
        onRepositoryOpened={() => {
          closeCount++
        }}
      />
    )
    fireEvent.click(
      await screen.findByRole('button', {
        name: 'Open & manage: vendor/library',
      })
    )

    const alert = await screen.findByRole('alert')
    assert.match(alert.textContent ?? '', /child repository is stale/)
    assert.equal(alert.getAttribute('aria-live'), 'assertive')
    assert.equal(closeCount, 0)
  })

  it('announces operation failures with semantic bilingual copy', async () => {
    localStorage.setItem(LanguageModeStorageKey, 'bilingual')
    const dispatcher = {
      getSubmodules: async () => [cloned],
      updateSubmodules: async () => {
        throw new Error('network offline')
      },
    } as unknown as Dispatcher

    render(
      <Submodules
        repository={parent}
        dispatcher={dispatcher}
        onRepositoryOpened={() => undefined}
      />
    )
    fireEvent.click(await screen.findByRole('button', { name: 'Update' }))

    const alert = await screen.findByRole('alert')
    assert.match(
      alert.querySelector('[lang="en"]')?.textContent ?? '',
      /Failed updating vendor\/library: Error: network offline/
    )
    assert.match(
      alert.querySelector('[lang="zh-HK"]')?.textContent ?? '',
      /未能更新 vendor\/library：Error: network offline/
    )
    assert.equal(alert.getAttribute('aria-live'), 'assertive')
  })
})
