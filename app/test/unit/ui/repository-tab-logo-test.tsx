import assert from 'node:assert'
import { describe, it } from 'node:test'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import * as React from 'react'
import { DefaultAppearanceCustomization } from '../../../src/models/appearance-customization'
import { DefaultRepositoryLogoDesign } from '../../../src/models/repository-logo'
import { Repository } from '../../../src/models/repository'
import { IRepositoryTab } from '../../../src/models/repository-tab'
import {
  AppearanceCustomizationStorageKey,
  setAppearanceCustomization,
  setRepositoryAppearanceOverrides,
} from '../../../src/lib/appearance-customization'
import { RepositoryTab } from '../../../src/ui/repository-tabs/repository-tab'
import { render, waitFor } from '../../helpers/ui/render'
import { setupFixtureRepository } from '../../helpers/repositories'

function tabFor(repository: Repository): IRepositoryTab {
  return {
    id: 'logo-tab',
    repositoryId: repository.id,
    repositoryPath: repository.path,
    customLabel: null,
    titleStyle: null,
  }
}

function renderRepositoryTab(repository: Repository) {
  return (
    <RepositoryTab
      tab={tabFor(repository)}
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
    />
  )
}

describe('RepositoryTab repository logo', () => {
  it('keeps the missing-repository warning icon visible', () => {
    const repository = new Repository('/work/missing-logo-tab', 700, null, true)
    const view = render(renderRepositoryTab(repository))

    assert.ok(view.container.querySelector('svg.octicon.repository-tab-icon'))
    assert.equal(
      view.container.querySelector('svg.repository-logo-small'),
      null
    )
  })

  it('loads the profile fallback and refreshes after a local override is saved', async t => {
    const path = await setupFixtureRepository(t, 'test-repo')
    const repository = new Repository(path, 701, null, false)
    setAppearanceCustomization({
      ...DefaultAppearanceCustomization,
      repositoryLogo: {
        ...DefaultRepositoryLogoDesign,
        background: {
          ...DefaultRepositoryLogoDesign.background,
          primaryColor: '#123456',
        },
      },
    })

    const view = render(renderRepositoryTab(repository))

    await waitFor(() =>
      assert.ok(view.container.querySelector('[fill="#123456"]'))
    )

    await setRepositoryAppearanceOverrides(repository, {
      repositoryLogo: {
        ...DefaultRepositoryLogoDesign,
        background: {
          ...DefaultRepositoryLogoDesign.background,
          primaryColor: '#654321',
        },
      },
    })
    await waitFor(() =>
      assert.ok(view.container.querySelector('[fill="#654321"]'))
    )
  })

  it('refreshes an inherited logo after profile history restores local storage', async t => {
    const path = await setupFixtureRepository(t, 'test-repo')
    const repository = new Repository(path, 702, null, false)
    setAppearanceCustomization({
      ...DefaultAppearanceCustomization,
      repositoryLogo: {
        ...DefaultRepositoryLogoDesign,
        background: {
          ...DefaultRepositoryLogoDesign.background,
          primaryColor: '#112233',
        },
      },
    })
    const view = render(renderRepositoryTab(repository))

    await waitFor(() =>
      assert.ok(view.container.querySelector('[fill="#112233"]'))
    )

    // Profile history restore applies the registered localStorage snapshot and
    // then rerenders profile-backed surfaces; it intentionally does not call
    // the appearance editor setter (and therefore emits no logo event).
    localStorage.setItem(
      AppearanceCustomizationStorageKey,
      JSON.stringify({
        ...DefaultAppearanceCustomization,
        repositoryLogo: {
          ...DefaultRepositoryLogoDesign,
          background: {
            ...DefaultRepositoryLogoDesign.background,
            primaryColor: '#445566',
          },
        },
      })
    )
    view.rerender(renderRepositoryTab(repository))

    await waitFor(() =>
      assert.ok(view.container.querySelector('[fill="#445566"]'))
    )
  })

  it('does not retain another repository logo when a replacement read fails', async t => {
    const firstPath = await setupFixtureRepository(t, 'test-repo')
    const firstRepository = new Repository(firstPath, 703, null, false)
    setAppearanceCustomization({
      ...DefaultAppearanceCustomization,
      repositoryLogo: {
        ...DefaultRepositoryLogoDesign,
        background: {
          ...DefaultRepositoryLogoDesign.background,
          primaryColor: '#112233',
        },
      },
    })
    await setRepositoryAppearanceOverrides(firstRepository, {
      repositoryLogo: {
        ...DefaultRepositoryLogoDesign,
        background: {
          ...DefaultRepositoryLogoDesign.background,
          primaryColor: '#aa0000',
        },
      },
    })
    const view = render(renderRepositoryTab(firstRepository))
    await waitFor(() =>
      assert.ok(view.container.querySelector('[fill="#aa0000"]'))
    )

    const nonRepositoryPath = await mkdtemp(
      join(tmpdir(), 'desktop-material-logo-')
    )
    t.after(() => rm(nonRepositoryPath, { recursive: true, force: true }))
    const replacement = new Repository(nonRepositoryPath, 704, null, false)
    view.rerender(renderRepositoryTab(replacement))

    await waitFor(() =>
      assert.ok(view.container.querySelector('[fill="#112233"]'))
    )
    assert.equal(view.container.querySelector('[fill="#aa0000"]'), null)
  })
})
