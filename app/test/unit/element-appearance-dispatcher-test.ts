import assert from 'node:assert'
import { describe, it } from 'node:test'

import { Dispatcher } from '../../src/ui/dispatcher/dispatcher'
import {
  ProfileAppearanceElementId,
  RepositoryAppearanceElementId,
} from '../../src/models/element-appearance'
import type { Repository } from '../../src/models/repository'

const historySource = {
  getHistory: async () => ({ commits: [], hasMore: false }),
  getFiles: async () => [],
  getDiff: async () => '',
  undoLastChange: async () => {},
  redoLastChange: async () => {},
  restoreTo: async () => {},
}

function createDispatcher(coordinator?: object): Dispatcher {
  return new Dispatcher(
    {} as never,
    {} as never,
    { increment: () => {} } as never,
    {} as never,
    {} as never,
    {} as never,
    {} as never,
    undefined,
    coordinator as never
  )
}

describe('element appearance Dispatcher routing', () => {
  it('reports unavailable coordination without exposing an unready store', () => {
    const dispatcher = createDispatcher()

    assert.equal(dispatcher.isElementAppearanceCoordinatorReady(), false)
    assert.throws(
      () =>
        dispatcher.getProfileAppearanceElement(
          ProfileAppearanceElementId.Toolbar
        ),
      /not initialized/
    )
  })

  it('routes typed profile and feature operations to their exact owners', async () => {
    const calls = new Array<ReadonlyArray<unknown>>()
    const toolbar = {
      toolbarLabels: 'labels',
      toolbarDensity: 'compact',
    } as const
    const coordinator = {
      getState: () => ({ initialized: true }),
      getProfileElement: (id: string) => {
        calls.push(['get-profile', id])
        return toolbar
      },
      setProfileElement: async (
        id: string,
        value: unknown,
        description?: string
      ) => {
        calls.push(['set-profile', id, value, description])
      },
      getProfileHistorySource: (id: string) => {
        calls.push(['profile-history', id])
        return historySource
      },
      getProfileRepositoryPath: (id: string) => {
        calls.push(['profile-path', id])
        return `C:\\appearance\\${id}`
      },
      ensureFeatureElement: async (id: string, seed?: boolean) => {
        calls.push(['get-feature', id, seed])
        return { highlighted: seed ?? false }
      },
      setFeatureElement: async (id: string, highlighted: boolean) => {
        calls.push(['set-feature', id, highlighted])
      },
      getFeatureHistorySource: (id: string) => {
        calls.push(['feature-history', id])
        return historySource
      },
      getFeatureRepositoryPath: (id: string) => {
        calls.push(['feature-path', id])
        return `C:\\appearance\\features\\${id}`
      },
    }
    const dispatcher = createDispatcher(coordinator)

    assert.equal(dispatcher.isElementAppearanceCoordinatorReady(), true)
    assert.equal(
      dispatcher.getProfileAppearanceElement(
        ProfileAppearanceElementId.Toolbar
      ),
      toolbar
    )
    await dispatcher.setProfileAppearanceElement(
      ProfileAppearanceElementId.Toolbar,
      toolbar,
      'Compact toolbar'
    )
    assert.equal(
      dispatcher.getProfileAppearanceHistorySource(
        ProfileAppearanceElementId.Toolbar
      ),
      historySource
    )
    assert.equal(
      dispatcher.getProfileAppearanceRepositoryPath(
        ProfileAppearanceElementId.Toolbar
      ),
      'C:\\appearance\\toolbar'
    )
    assert.deepEqual(
      await dispatcher.getFeatureAppearanceElement('commit-button', true),
      { highlighted: true }
    )
    await dispatcher.setFeatureAppearanceElement('commit-button', false)
    assert.equal(
      dispatcher.getFeatureAppearanceHistorySource('commit-button'),
      historySource
    )
    assert.equal(
      dispatcher.getFeatureAppearanceRepositoryPath('commit-button'),
      'C:\\appearance\\features\\commit-button'
    )
    assert.deepEqual(calls, [
      ['get-profile', 'toolbar'],
      ['set-profile', 'toolbar', toolbar, 'Compact toolbar'],
      ['profile-history', 'toolbar'],
      ['profile-path', 'toolbar'],
      ['get-feature', 'commit-button', true],
      ['set-feature', 'commit-button', false],
      ['feature-history', 'commit-button'],
      ['feature-path', 'commit-button'],
    ])
  })

  it('resolves and routes repository element owners independently', async () => {
    const repository = { path: 'C:\\work\\repo' } as Repository
    const listName = { style: { fontWeight: 'bold' } } as const
    const logo = { logo: null }
    const elements = {
      workspace: { accentPalette: null, surfacePalette: null },
      toolbar: { toolbarLabels: null, toolbarDensity: null },
      tabs: { tabDensity: null, tabWidth: null },
      'list-name': listName,
      logo,
    }
    const profileLogo = { kind: 'initials', text: 'DEFAULT' }
    const calls = new Array<ReadonlyArray<unknown>>()
    const coordinator = {
      getState: () => ({ initialized: true }),
      ensureRepositoryElements: async (repo: Repository, legacy?: unknown) => {
        calls.push(['get-repository', repo, legacy])
        return elements
      },
      getProfileElement: (id: string) => {
        calls.push(['get-profile', id])
        return profileLogo
      },
      setRepositoryElement: async (
        repo: Repository,
        id: string,
        value: unknown
      ) => {
        calls.push(['set-repository', repo, id, value])
      },
      getRepositoryHistorySource: async (repo: Repository, id: string) => {
        calls.push(['repository-history', repo, id])
        return historySource
      },
      getRepositoryElementPath: async (repo: Repository, id: string) => {
        calls.push(['repository-path', repo, id])
        return `C:\\appearance\\repositories\\${id}`
      },
    }
    const dispatcher = createDispatcher(coordinator)

    assert.equal(
      await dispatcher.getRepositoryAppearanceElements(repository),
      elements
    )
    assert.deepEqual(
      await dispatcher.getResolvedRepositoryElementAppearance(repository),
      { logo: profileLogo, listNameStyle: listName.style }
    )
    await dispatcher.setRepositoryAppearanceElement(
      repository,
      RepositoryAppearanceElementId.ListName,
      listName
    )
    assert.equal(
      await dispatcher.getRepositoryAppearanceHistorySource(
        repository,
        RepositoryAppearanceElementId.ListName
      ),
      historySource
    )
    assert.equal(
      await dispatcher.getRepositoryAppearanceRepositoryPath(
        repository,
        RepositoryAppearanceElementId.ListName
      ),
      'C:\\appearance\\repositories\\list-name'
    )
    assert.deepEqual(calls, [
      ['get-repository', repository, undefined],
      ['get-repository', repository, undefined],
      ['get-profile', 'default-repository-logo'],
      ['set-repository', repository, 'list-name', listName],
      ['repository-history', repository, 'list-name'],
      ['repository-path', repository, 'list-name'],
    ])
  })
})
