import assert from 'node:assert'
import { describe, it } from 'node:test'
import * as React from 'react'

import {
  DefaultRepositoryAppearanceElementSettings,
  IRepositoryAppearanceElementSettings,
  ProfileAppearanceElementId,
  RepositoryAppearanceElementId,
} from '../../../src/models/element-appearance'
import { Repository } from '../../../src/models/repository'
import {
  DefaultRepositoryLogoDesign,
  IRepositoryLogoDesign,
} from '../../../src/models/repository-logo'
import { ITabTitleStyle } from '../../../src/models/repository-tab'
import { IRepositoryTab } from '../../../src/models/repository-tab'
import {
  IRepositoryLogoChangedDetail,
  RepositoryLogoChangedEvent,
} from '../../../src/lib/appearance-customization'
import {
  getAppearanceRepositoryDisplayPath,
  RepositoryListNameAppearanceEditor,
  RepositoryLogoAppearanceEditor,
} from '../../../src/ui/appearance'
import { Dispatcher } from '../../../src/ui/dispatcher'
import { RepositoryListItem } from '../../../src/ui/repositories-list/repository-list-item'
import { RepositoryTab } from '../../../src/ui/repository-tabs/repository-tab'
import { IVersionedStoreHistorySource } from '../../../src/ui/version-history'
import { fireEvent, render, screen, waitFor } from '../../helpers/ui/render'

const RepositoryPath = '/work/desktop-material'
const ListNameSettingsPath =
  'C:/profile/appearance-elements/repositories/one/list-name'
const LogoSettingsPath = 'C:/profile/appearance-elements/repositories/one/logo'
const ProfileLogoSettingsPath =
  'C:/profile/appearance-elements/profile/default-repository-logo'
const PrivatePathTitle = 'Private root hidden; copy the exact path'

function logo(primaryColor: string): IRepositoryLogoDesign {
  return {
    ...DefaultRepositoryLogoDesign,
    background: {
      ...DefaultRepositoryLogoDesign.background,
      primaryColor,
    },
  }
}

function historySource(
  onRead?: () => void,
  onUndo?: () => void
): IVersionedStoreHistorySource {
  return {
    getHistory: () => {
      onRead?.()
      return Promise.resolve({
        entries: [],
        total: 0,
        hasMore: false,
        canUndo: onUndo !== undefined,
        canRedo: false,
      })
    },
    getFiles: () => Promise.resolve(['setting.json']),
    getDiff: () => Promise.resolve(''),
    undoLastChange: async () => onUndo?.(),
    redoLastChange: () => Promise.resolve(),
    restoreTo: () => Promise.resolve(),
  }
}

interface IRecordedRepositoryElementChange {
  readonly id: RepositoryAppearanceElementId
  readonly value: unknown
}

interface IDispatcherObservations {
  readonly profileLogoChanges?: IRepositoryLogoDesign[]
  readonly historyReads?: string[]
  readonly initialLogoOverride?: IRepositoryLogoDesign
  readonly logoAfterHistoryUndo?: IRepositoryLogoDesign
  readonly onRepositoryLogoHistoryUndo?: () => void
}

function createDispatcher(
  changes: IRecordedRepositoryElementChange[],
  observations: IDispatcherObservations = {}
) {
  let listNameStyle: ITabTitleStyle | null = null
  let logoOverride: IRepositoryLogoDesign | null =
    observations.initialLogoOverride ?? null
  let profileLogo = logo('#123456')

  const elements = (): IRepositoryAppearanceElementSettings => ({
    ...DefaultRepositoryAppearanceElementSettings,
    [RepositoryAppearanceElementId.ListName]: { style: listNameStyle },
    [RepositoryAppearanceElementId.Logo]: { logo: logoOverride },
  })

  return {
    isElementAppearanceCoordinatorReady: () => true,
    getResolvedRepositoryElementAppearance: async () => ({
      logo: logoOverride ?? profileLogo,
      listNameStyle,
    }),
    getRepositoryAppearanceElements: async () => elements(),
    getRepositoryAppearanceHistorySource: async (
      _repository: Repository,
      id: RepositoryAppearanceElementId
    ) =>
      historySource(
        () => observations.historyReads?.push(`repository:${id}`),
        id === RepositoryAppearanceElementId.Logo &&
          observations.onRepositoryLogoHistoryUndo !== undefined
          ? () => {
              logoOverride = observations.logoAfterHistoryUndo ?? null
              observations.onRepositoryLogoHistoryUndo?.()
            }
          : undefined
      ),
    getRepositoryAppearanceRepositoryPath: async (
      _repository: Repository,
      id: RepositoryAppearanceElementId
    ) =>
      id === RepositoryAppearanceElementId.ListName
        ? ListNameSettingsPath
        : LogoSettingsPath,
    getProfileAppearanceElement: (id: ProfileAppearanceElementId) => {
      assert.equal(id, ProfileAppearanceElementId.DefaultRepositoryLogo)
      return profileLogo
    },
    getProfileAppearanceHistorySource: (id: ProfileAppearanceElementId) => {
      assert.equal(id, ProfileAppearanceElementId.DefaultRepositoryLogo)
      return historySource(() => observations.historyReads?.push('profile'))
    },
    getProfileAppearanceRepositoryPath: (id: ProfileAppearanceElementId) => {
      assert.equal(id, ProfileAppearanceElementId.DefaultRepositoryLogo)
      return ProfileLogoSettingsPath
    },
    setProfileAppearanceElement: async (
      id: ProfileAppearanceElementId,
      value: IRepositoryLogoDesign
    ) => {
      assert.equal(id, ProfileAppearanceElementId.DefaultRepositoryLogo)
      profileLogo = value
      observations.profileLogoChanges?.push(value)
    },
    setRepositoryAppearanceElement: async (
      _repository: Repository,
      id: RepositoryAppearanceElementId,
      value: {
        style?: ITabTitleStyle | null
        logo?: IRepositoryLogoDesign | null
      }
    ) => {
      if (id === RepositoryAppearanceElementId.ListName) {
        listNameStyle = value.style ?? null
      } else if (id === RepositoryAppearanceElementId.Logo) {
        logoOverride = value.logo ?? null
      }
      changes.push({ id, value })
    },
  } as unknown as Dispatcher
}

function AppearanceRow(props: {
  readonly dispatcher: Dispatcher
  readonly onBackgroundContextMenu?: () => void
}) {
  return (
    <div id="foldout-container">
      <div className="foldout" onContextMenu={props.onBackgroundContextMenu}>
        <RepositoryListItem
          repository={new Repository(RepositoryPath, 1, null, false)}
          needsDisambiguation={false}
          matches={{ title: [], subtitle: [] }}
          aheadBehind={null}
          changedFilesCount={0}
          branchName={null}
          dispatcher={props.dispatcher}
        />
      </div>
    </div>
  )
}

function assertPortaledOutsideFoldout(editor: HTMLElement): void {
  const mount = editor.parentElement
  assert.ok(mount)
  assert.equal(
    mount.classList.contains('anchored-appearance-editor-mount'),
    true
  )
  assert.equal(editor.closest('.foldout'), null)
  assert.equal(mount.parentElement?.id, 'foldout-container')
}

function ListNameHarness() {
  const [value, setValue] = React.useState<ITabTitleStyle | null>(null)
  return (
    <RepositoryListNameAppearanceEditor
      value={value}
      repositoryName="desktop-material"
      onChange={setValue}
    />
  )
}

describe('repository element appearance editors', () => {
  it('provides a controlled Word-style list-name editor and profile-aware logo inheritance', () => {
    render(<ListNameHarness />)

    fireEvent.click(screen.getByRole('button', { name: 'Bold' }))
    assert.equal(
      screen.getByRole('button', { name: 'Bold' }).getAttribute('aria-pressed'),
      'true'
    )

    fireEvent.change(screen.getByLabelText('Font'), {
      target: { value: 'Consolas' },
    })
    assert.equal(
      (screen.getByLabelText('Font') as HTMLSelectElement).value,
      'Consolas'
    )

    fireEvent.click(screen.getByRole('button', { name: 'Inherit' }))
    assert.ok(screen.getByText('Inheriting row typography'))

    const profileLogo = logo('#123456')
    const logoChanges: Array<IRepositoryLogoDesign | null> = []
    render(
      <RepositoryLogoAppearanceEditor
        value={null}
        profileValue={profileLogo}
        repositoryName="desktop-material"
        onChange={value => logoChanges.push(value)}
      />
    )
    assert.ok(screen.getByText('Profile default'))
    assert.equal(
      screen
        .getByRole('button', { name: 'Inherit profile logo' })
        .getAttribute('aria-disabled'),
      'true'
    )
  })

  it('opens the actual repository name beside itself, commits only list-name, and exposes its exact history path', async () => {
    const changes: IRecordedRepositoryElementChange[] = []
    let backgroundMenus = 0
    const view = render(
      <AppearanceRow
        dispatcher={createDispatcher(changes)}
        onBackgroundContextMenu={() => backgroundMenus++}
      />
    )

    const name = await screen.findByRole('button', {
      name: 'Customize desktop-material list-name appearance',
    })
    name.focus()

    // Right-clicking the name no longer opens the editor directly (that was too
    // easy to trigger by accident). The contextmenu event is not cancelled and
    // bubbles to the row so the repository context menu can handle it.
    const contextMenuNotCancelled = fireEvent.contextMenu(name)
    assert.equal(contextMenuNotCancelled, true)
    assert.equal(screen.queryByRole('dialog'), null)
    assert.equal(backgroundMenus, 1)

    // The keyboard path (Shift+F10) still opens the anchored editor directly.
    fireEvent.keyDown(name, { key: 'F10', shiftKey: true })

    const editor = await screen.findByRole('dialog', {
      name: 'desktop-material list-name appearance',
    })
    assertPortaledOutsideFoldout(editor)
    assert.equal(
      screen.getByTitle(PrivatePathTitle).textContent,
      getAppearanceRepositoryDisplayPath(ListNameSettingsPath)
    )

    fireEvent.click(screen.getByRole('button', { name: 'Bold' }))
    await waitFor(() => {
      assert.deepEqual(changes.at(-1), {
        id: RepositoryAppearanceElementId.ListName,
        value: { style: { bold: true } },
      })
    })
    assert.equal((name as HTMLElement).style.fontWeight, 'bold')

    fireEvent.click(screen.getByRole('tab', { name: 'History' }))
    assert.ok(
      await screen.findByRole('dialog', {
        name: 'desktop-material list-name appearance history',
      })
    )

    // While the anchored editor is open, right-clicking the row still reaches
    // the row's context-menu owner (the editor is portaled out of the row).
    fireEvent.contextMenu(
      view.container.querySelector('.repository-list-item')!
    )
    assert.equal(backgroundMenus, 2)
  })

  it('opens the actual logo with Shift+F10, writes a separate logo owner, inherits, and restores focus on Escape', async () => {
    const changes: IRecordedRepositoryElementChange[] = []
    render(<AppearanceRow dispatcher={createDispatcher(changes)} />)

    const logoTarget = await screen.findByRole('button', {
      name: 'Customize desktop-material repository logo',
    })
    logoTarget.focus()
    fireEvent.keyDown(logoTarget, { key: 'F10' })
    assert.equal(screen.queryByRole('dialog'), null)

    fireEvent.keyDown(logoTarget, { key: 'F10', shiftKey: true })
    const editor = await screen.findByRole('dialog', {
      name: 'desktop-material repository logo',
    })
    assertPortaledOutsideFoldout(editor)
    assert.equal(
      screen.getByTitle(PrivatePathTitle).textContent,
      getAppearanceRepositoryDisplayPath(LogoSettingsPath)
    )
    assert.ok(screen.getByText('Profile default'))

    fireEvent.click(screen.getByRole('button', { name: 'Monogram' }))
    await waitFor(() => {
      assert.equal(changes.at(-1)?.id, RepositoryAppearanceElementId.Logo)
      assert.notEqual(
        (changes.at(-1)?.value as { logo: IRepositoryLogoDesign | null }).logo,
        null
      )
    })

    fireEvent.click(
      screen.getByRole('button', { name: 'Inherit profile logo' })
    )
    await waitFor(() => {
      assert.deepEqual(changes.at(-1), {
        id: RepositoryAppearanceElementId.Logo,
        value: { logo: null },
      })
    })

    fireEvent.keyDown(window, { key: 'Escape' })
    await waitFor(() => {
      assert.equal(screen.queryByRole('dialog'), null)
      assert.equal(document.activeElement, logoTarget)
    })
  })

  it('edits the inherited profile default beside the row with its own Git history, then safely returns to the repository owner', async () => {
    const changes: IRecordedRepositoryElementChange[] = []
    const profileLogoChanges: IRepositoryLogoDesign[] = []
    const historyReads: string[] = []
    render(
      <AppearanceRow
        dispatcher={createDispatcher(changes, {
          profileLogoChanges,
          historyReads,
        })}
      />
    )

    const logoTarget = await screen.findByRole('button', {
      name: 'Customize desktop-material repository logo',
    })
    logoTarget.focus()
    fireEvent.keyDown(logoTarget, { key: 'F10', shiftKey: true })
    assert.ok(
      await screen.findByRole('dialog', {
        name: 'desktop-material repository logo',
      })
    )
    assert.equal(
      screen.getByTitle(PrivatePathTitle).textContent,
      getAppearanceRepositoryDisplayPath(LogoSettingsPath)
    )

    fireEvent.click(
      screen.getByRole('button', { name: 'Edit profile default' })
    )
    assert.ok(
      await screen.findByRole('dialog', {
        name: 'Profile default repository logo for desktop-material',
      })
    )
    assert.equal(
      screen.getByTitle(PrivatePathTitle).textContent,
      getAppearanceRepositoryDisplayPath(ProfileLogoSettingsPath)
    )

    fireEvent.change(screen.getByLabelText('Color'), {
      target: { value: '#abcdef' },
    })
    await waitFor(() => assert.equal(profileLogoChanges.length, 1))
    assert.equal(changes.length, 0)

    fireEvent.click(screen.getByRole('tab', { name: 'History' }))
    assert.ok(
      await screen.findByRole('dialog', {
        name: 'Profile default repository logo for desktop-material history',
      })
    )
    await waitFor(() => assert.ok(historyReads.includes('profile')))
    const profileDisplayPath = getAppearanceRepositoryDisplayPath(
      ProfileLogoSettingsPath
    )
    assert.equal(
      screen
        .getByText(new RegExp(profileDisplayPath.replace(/\\/g, '\\\\')))
        .textContent?.includes(profileDisplayPath),
      true
    )

    fireEvent.click(
      screen.getByRole('button', {
        name: 'Close Profile default repository logo for desktop-material history',
      })
    )
    await screen.findByRole('dialog', {
      name: 'Profile default repository logo for desktop-material',
    })
    fireEvent.click(
      screen.getByRole('button', { name: 'Back to repository logo' })
    )
    assert.ok(
      await screen.findByRole('dialog', {
        name: 'desktop-material repository logo',
      })
    )
    assert.equal(
      screen.getByTitle(PrivatePathTitle).textContent,
      getAppearanceRepositoryDisplayPath(LogoSettingsPath)
    )

    fireEvent.click(screen.getByRole('button', { name: 'Monogram' }))
    await waitFor(() =>
      assert.equal(changes.at(-1)?.id, RepositoryAppearanceElementId.Logo)
    )
    assert.equal(profileLogoChanges.length, 1)

    fireEvent.keyDown(window, { key: 'Escape' })
    await waitFor(() => {
      assert.equal(screen.queryByRole('dialog'), null)
      assert.equal(document.activeElement, logoTarget)
    })
  })

  it('announces a repository-logo history mutation so an existing tab refreshes', async () => {
    const changes: IRecordedRepositoryElementChange[] = []
    let undoCount = 0
    const dispatcher = createDispatcher(changes, {
      initialLogoOverride: logo('#414141'),
      logoAfterHistoryUndo: logo('#515151'),
      onRepositoryLogoHistoryUndo: () => undoCount++,
    })
    const repository = new Repository(RepositoryPath, 12, null, false)
    const tab: IRepositoryTab = {
      id: 'logo-history-tab',
      repositoryId: repository.id,
      repositoryPath: repository.path,
      customLabel: null,
      titleStyle: null,
    }
    const view = render(
      <>
        <AppearanceRow dispatcher={dispatcher} />
        <RepositoryTab
          tab={tab}
          repository={repository}
          isActive={true}
          isDragging={false}
          onSelect={() => undefined}
          onClose={() => undefined}
          onToggleFavorite={() => undefined}
          onRename={() => undefined}
          onContextMenu={() => undefined}
          onOpenStyleEditor={() => undefined}
          onDragStart={() => undefined}
          onDragOver={() => undefined}
          onDrop={() => undefined}
          onDragEnd={() => undefined}
          dispatcher={dispatcher}
        />
      </>
    )

    await waitFor(() =>
      assert.ok(
        view.container.querySelector('.repository-tab-icon [fill="#414141"]')
      )
    )
    fireEvent.keyDown(
      await screen.findByRole('button', {
        name: 'Customize desktop-material repository logo',
      }),
      { key: 'F10', shiftKey: true }
    )
    await screen.findByRole('dialog', {
      name: 'desktop-material repository logo',
    })
    fireEvent.click(screen.getByRole('tab', { name: 'History' }))
    await screen.findByRole('dialog', {
      name: 'desktop-material repository logo history',
    })
    await waitFor(() =>
      assert.equal(
        screen.getByRole('button', { name: 'Undo' }).hasAttribute('disabled'),
        false
      )
    )
    fireEvent.click(screen.getByRole('button', { name: 'Undo' }))

    await waitFor(() => assert.equal(undoCount, 1))
    await waitFor(() =>
      assert.ok(
        view.container.querySelector('.repository-tab-icon [fill="#515151"]')
      )
    )
  })

  it('refreshes an existing repository tab from the dedicated repository logo owner', async () => {
    const changes: IRecordedRepositoryElementChange[] = []
    const dispatcher = createDispatcher(changes)
    const repository = new Repository(RepositoryPath, 9, null, false)
    const tab: IRepositoryTab = {
      id: 'dedicated-logo-tab',
      repositoryId: repository.id,
      repositoryPath: repository.path,
      customLabel: null,
      titleStyle: null,
    }
    const view = render(
      <RepositoryTab
        tab={tab}
        repository={repository}
        isActive={true}
        isDragging={false}
        onSelect={() => undefined}
        onClose={() => undefined}
        onToggleFavorite={() => undefined}
        onRename={() => undefined}
        onContextMenu={() => undefined}
        onOpenStyleEditor={() => undefined}
        onDragStart={() => undefined}
        onDragOver={() => undefined}
        onDrop={() => undefined}
        onDragEnd={() => undefined}
        dispatcher={dispatcher}
      />
    )

    await waitFor(() =>
      assert.ok(view.container.querySelector('[fill="#123456"]'))
    )
    await dispatcher.setRepositoryAppearanceElement(
      repository,
      RepositoryAppearanceElementId.Logo,
      { logo: logo('#abcdef') }
    )
    document.dispatchEvent(
      new window.CustomEvent<IRepositoryLogoChangedDetail>(
        RepositoryLogoChangedEvent,
        { detail: { repositoryPath: repository.path } }
      )
    )
    await waitFor(() =>
      assert.ok(view.container.querySelector('[fill="#abcdef"]'))
    )
  })
})
