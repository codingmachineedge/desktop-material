import './profile-history-test-env'

import assert from 'node:assert'
import {
  mkdir,
  readFile,
  readdir,
  realpath,
  rename,
  stat,
  symlink,
  writeFile,
} from 'fs/promises'
import { isAbsolute, join, relative, resolve, sep } from 'path'
import { describe, it } from 'node:test'

import {
  ElementAppearanceCoordinator,
  RepositoryAppearanceIdConfigKey,
  ensureRepositoryAppearanceId,
} from '../../src/lib/stores/element-appearance-coordinator'
import { ProfileStore } from '../../src/lib/stores/profile-store'
import { getConfigValue, setConfigValue } from '../../src/lib/git/config'
import { git } from '../../src/lib/git/core'
import {
  ProfileAppearanceElementId,
  RepositoryAppearanceElementId,
} from '../../src/models/element-appearance'
import { Repository } from '../../src/models/repository'
import { createTempDirectory } from '../helpers/temp'

const appearanceIdPattern =
  /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/

function fakeProfileStore(): ProfileStore {
  return {
    getActiveProfileKey: () => 'local',
    getActiveProfileRepositoryPath: () => null,
    onDidUpdate: () => ({ dispose: () => undefined }),
  } as unknown as ProfileStore
}

async function createCoordinator(root: string) {
  localStorage.clear()
  const coordinator = new ElementAppearanceCoordinator(fakeProfileStore())
  await coordinator.initialize(root)
  return coordinator
}

async function readSetting(path: string): Promise<Record<string, unknown>> {
  return JSON.parse(
    await readFile(join(path, 'setting.json'), 'utf8')
  ) as Record<string, unknown>
}

async function canonicalGitRoot(path: string): Promise<string> {
  const result = await git(
    ['rev-parse', '--show-toplevel'],
    path,
    'elementAppearanceCoordinatorTestRoot'
  )
  return realpath(resolve(result.stdout.trim()))
}

function assertPathIsWithin(root: string, candidate: string) {
  const child = relative(resolve(root), resolve(candidate))
  assert.equal(
    child !== '' &&
      child !== '..' &&
      !child.startsWith(`..${sep}`) &&
      !isAbsolute(child),
    true,
    `${candidate} escaped ${root}`
  )
}

describe('ElementAppearanceCoordinator', () => {
  it('owns nine independent profile repositories and projects isolated history operations', async t => {
    const root = join(await createTempDirectory(t), 'appearance-elements')
    const coordinator = await createCoordinator(root)
    const elementIds = Object.values(ProfileAppearanceElementId)

    assert.equal(elementIds.length, 9)
    const repositoryPaths = elementIds.map(id =>
      coordinator.getProfileRepositoryPath(id)
    )
    assert.equal(new Set(repositoryPaths).size, 9)

    const gitRoots = new Set<string>()
    for (const repositoryPath of repositoryPaths) {
      assertPathIsWithin(root, repositoryPath)
      assert.equal(
        (await stat(join(repositoryPath, '.git'))).isDirectory(),
        true
      )
      const document = await readSetting(repositoryPath)
      assert.equal(document.version, 1)
      assert.deepEqual(Object.keys(document).sort(), ['value', 'version'])
      gitRoots.add(await canonicalGitRoot(repositoryPath))
    }
    assert.equal(gitRoots.size, 9)

    const toolbarId = ProfileAppearanceElementId.Toolbar
    const toolbarHistory = coordinator.getProfileHistorySource(toolbarId)
    const initialToolbarHistory = await toolbarHistory.getHistory()
    const initialSha = initialToolbarHistory.entries[0].sha
    assert.equal(initialToolbarHistory.total, 1)
    assert.equal(
      coordinator.getState().appearance.toolbarDensity,
      'comfortable'
    )

    await coordinator.setProfileElement(toolbarId, {
      toolbarLabels: 'icons',
      toolbarDensity: 'compact',
    })
    await coordinator.flush()

    assert.equal(coordinator.getState().appearance.toolbarDensity, 'compact')
    assert.equal(coordinator.getState().appearance.toolbarLabels, 'icons')
    assert.equal((await toolbarHistory.getHistory()).total, 2)
    for (const id of elementIds) {
      if (id !== toolbarId) {
        assert.equal(
          (await coordinator.getProfileHistorySource(id).getHistory()).total,
          1,
          `${id} history advanced with a toolbar-only edit`
        )
      }
    }

    await toolbarHistory.undoLastChange!()
    assert.equal(
      coordinator.getState().appearance.toolbarDensity,
      'comfortable'
    )
    assert.equal(coordinator.getState().appearance.toolbarLabels, 'auto')

    await toolbarHistory.redoLastChange!()
    assert.equal(coordinator.getState().appearance.toolbarDensity, 'compact')
    assert.equal(coordinator.getState().appearance.toolbarLabels, 'icons')

    await toolbarHistory.restoreTo!(initialSha)
    assert.equal(
      coordinator.getState().appearance.toolbarDensity,
      'comfortable'
    )
    assert.equal(coordinator.getState().appearance.toolbarLabels, 'auto')
    assert.equal((await toolbarHistory.getHistory()).total, 5)
  })

  it('isolates feature and tab instances, including traversal-shaped ids', async t => {
    const root = join(await createTempDirectory(t), 'appearance-elements')
    const coordinator = await createCoordinator(root)

    await coordinator.ensureFeatureElement('feature-alpha', false)
    await coordinator.ensureFeatureElement('../../feature-beta', true)
    const alphaFeaturePath =
      coordinator.getFeatureRepositoryPath('feature-alpha')
    const betaFeaturePath =
      coordinator.getFeatureRepositoryPath('../../feature-beta')
    assert.notEqual(alphaFeaturePath, betaFeaturePath)
    assertPathIsWithin(root, alphaFeaturePath)
    assertPathIsWithin(root, betaFeaturePath)
    assert.equal((await readSetting(alphaFeaturePath)).version, 1)
    assert.deepEqual((await readSetting(alphaFeaturePath)).value, {
      highlighted: false,
    })
    assert.deepEqual((await readSetting(betaFeaturePath)).value, {
      highlighted: true,
    })

    await coordinator.setFeatureElement('feature-alpha', true)
    await coordinator.flush()
    assert.equal(
      (await coordinator.getFeatureHistorySource('feature-alpha').getHistory())
        .total,
      2
    )
    assert.equal(
      (
        await coordinator
          .getFeatureHistorySource('../../feature-beta')
          .getHistory()
      ).total,
      1
    )

    await assert.rejects(
      coordinator.ensureFeatureElement('   '),
      /stable bounded id/
    )
    await assert.rejects(
      coordinator.ensureFeatureElement('x'.repeat(257)),
      /stable bounded id/
    )

    await coordinator.ensureTabTitleElement('tab-alpha', { bold: true })
    await coordinator.ensureTabTitleElement('../../tab-beta', { italic: true })
    const alphaTabPath = coordinator.getTabTitleRepositoryPath('tab-alpha')
    const betaTabPath = coordinator.getTabTitleRepositoryPath('../../tab-beta')
    assert.notEqual(alphaTabPath, betaTabPath)
    assertPathIsWithin(root, alphaTabPath)
    assertPathIsWithin(root, betaTabPath)
    assert.deepEqual((await readSetting(alphaTabPath)).value, {
      style: { bold: true },
    })
    assert.deepEqual((await readSetting(betaTabPath)).value, {
      style: { italic: true },
    })

    await coordinator.setTabTitleElement('tab-alpha', { underline: true })
    await coordinator.flush()
    assert.equal(
      (await coordinator.getTabTitleHistorySource('tab-alpha').getHistory())
        .total,
      2
    )
    assert.equal(
      (
        await coordinator
          .getTabTitleHistorySource('../../tab-beta')
          .getHistory()
      ).total,
      1
    )
  })

  it('coalesces concurrent feature, tab, repository, and UUID initialization by owner key', async t => {
    const temp = await createTempDirectory(t)
    const root = join(temp, 'appearance-elements')
    const repositoryPath = join(temp, 'source-repository')
    await mkdir(repositoryPath)
    await git(['init'], repositoryPath, 'initializeConcurrentAppearanceRepo')
    const repository = new Repository(repositoryPath, 1, null, false)
    const coordinator = await createCoordinator(root)

    const featureResults = await Promise.all(
      Array.from({ length: 24 }, (_, index) =>
        coordinator.ensureFeatureElement('shared-feature', index !== 0)
      )
    )
    assert.equal(
      featureResults.every(value => !value.highlighted),
      true
    )
    assert.equal(
      (await coordinator.getFeatureHistorySource('shared-feature').getHistory())
        .total,
      1
    )

    const tabResults = await Promise.all(
      Array.from({ length: 24 }, (_, index) =>
        coordinator.ensureTabTitleElement(
          'shared-tab',
          index === 0 ? { bold: true } : { italic: true }
        )
      )
    )
    assert.equal(
      tabResults.every(value => value.style?.bold === true),
      true
    )
    assert.equal(
      (await coordinator.getTabTitleHistorySource('shared-tab').getHistory())
        .total,
      1
    )

    const appearanceIds = await Promise.all(
      Array.from({ length: 32 }, () => ensureRepositoryAppearanceId(repository))
    )
    assert.equal(new Set(appearanceIds).size, 1)
    assert.equal(
      await getConfigValue(repository, RepositoryAppearanceIdConfigKey, true),
      appearanceIds[0]
    )

    await Promise.all(
      Array.from({ length: 16 }, () =>
        coordinator.ensureRepositoryElements(repository, {})
      )
    )
    for (const id of Object.values(RepositoryAppearanceElementId)) {
      const history = await coordinator.getRepositoryHistorySource(
        repository,
        id
      )
      assert.equal((await history.getHistory()).total, 1)
    }
  })

  it('keeps repository element histories separate and follows the local UUID across a move', async t => {
    const temp = await createTempDirectory(t)
    const root = join(temp, 'appearance-elements')
    const sourcePath = join(temp, 'source-repository')
    const movedPath = join(temp, 'moved-repository')
    await mkdir(sourcePath)
    await git(['init'], sourcePath, 'initializeAppearanceSourceRepository')

    const sourceRepository = new Repository(sourcePath, 1, null, false)
    await setConfigValue(
      sourceRepository,
      RepositoryAppearanceIdConfigKey,
      '../../outside'
    )
    const coordinator = await createCoordinator(root)
    await coordinator.ensureRepositoryElements(sourceRepository, {})

    const appearanceId = await ensureRepositoryAppearanceId(sourceRepository)
    assert.match(appearanceId, appearanceIdPattern)
    assert.equal(
      await getConfigValue(
        sourceRepository,
        RepositoryAppearanceIdConfigKey,
        true
      ),
      appearanceId
    )

    const workspaceId = RepositoryAppearanceElementId.Workspace
    const toolbarId = RepositoryAppearanceElementId.Toolbar
    const workspacePath = await coordinator.getRepositoryElementPath(
      sourceRepository,
      workspaceId
    )
    const toolbarPath = await coordinator.getRepositoryElementPath(
      sourceRepository,
      toolbarId
    )
    assert.notEqual(workspacePath, toolbarPath)
    assertPathIsWithin(root, workspacePath)
    assertPathIsWithin(root, toolbarPath)
    assert.equal((await stat(join(workspacePath, '.git'))).isDirectory(), true)
    assert.equal((await stat(join(toolbarPath, '.git'))).isDirectory(), true)
    assert.equal((await readSetting(workspacePath)).version, 1)
    assert.equal((await readSetting(toolbarPath)).version, 1)

    await coordinator.setRepositoryElement(sourceRepository, workspaceId, {
      accentPalette: 'violet',
      surfacePalette: 'neutral',
    })
    await coordinator.flush()
    assert.equal(
      (
        await (
          await coordinator.getRepositoryHistorySource(
            sourceRepository,
            workspaceId
          )
        ).getHistory()
      ).total,
      2
    )
    assert.equal(
      (
        await (
          await coordinator.getRepositoryHistorySource(
            sourceRepository,
            toolbarId
          )
        ).getHistory()
      ).total,
      1
    )

    await rename(sourcePath, movedPath)
    const movedRepository = new Repository(movedPath, 2, null, false)
    assert.equal(
      await ensureRepositoryAppearanceId(movedRepository),
      appearanceId
    )
    assert.equal(
      await coordinator.getRepositoryElementPath(movedRepository, workspaceId),
      workspacePath
    )
    assert.equal(
      await coordinator.getRepositoryElementPath(movedRepository, toolbarId),
      toolbarPath
    )
  })

  it('refuses corrupt owned settings without overwriting them', async t => {
    const root = join(await createTempDirectory(t), 'appearance-elements')
    const coordinator = await createCoordinator(root)
    await coordinator.ensureFeatureElement('corruption-target', false)
    const repositoryPath =
      coordinator.getFeatureRepositoryPath('corruption-target')
    const settingPath = join(repositoryPath, 'setting.json')
    await writeFile(settingPath, '{broken')

    await assert.rejects(
      coordinator.setFeatureElement('corruption-target', true),
      /corrupt/i
    )
    assert.equal(await readFile(settingPath, 'utf8'), '{broken')
  })

  it('strictly validates each owner schema and restores valid crash-safe backups', async t => {
    const temp = await createTempDirectory(t)
    const root = join(temp, 'appearance-elements')
    const repositoryPath = join(temp, 'source-repository')
    await mkdir(repositoryPath)
    await git(['init'], repositoryPath, 'initializeRecoveryAppearanceRepo')
    const repository = new Repository(repositoryPath, 1, null, false)
    const first = await createCoordinator(root)

    await first.setProfileElement(ProfileAppearanceElementId.Toolbar, {
      toolbarLabels: 'icons',
      toolbarDensity: 'compact',
    })
    await first.flush()
    await first.setProfileElement(ProfileAppearanceElementId.Toolbar, {
      toolbarLabels: 'labels',
      toolbarDensity: 'comfortable',
    })
    await first.flush()
    const profilePath = first.getProfileRepositoryPath(
      ProfileAppearanceElementId.Toolbar
    )

    await first.ensureTabTitleElement('recovery-tab', { bold: true })
    await first.setTabTitleElement('recovery-tab', { italic: true })
    await first.flush()
    await first.setTabTitleElement('recovery-tab', { underline: true })
    await first.flush()
    const tabPath = first.getTabTitleRepositoryPath('recovery-tab')

    await first.ensureRepositoryElements(repository, {})
    await first.setRepositoryElement(
      repository,
      RepositoryAppearanceElementId.Workspace,
      { accentPalette: 'violet', surfacePalette: 'neutral' }
    )
    await first.flush()
    await first.setRepositoryElement(
      repository,
      RepositoryAppearanceElementId.Workspace,
      { accentPalette: 'teal', surfacePalette: 'tonal' }
    )
    await first.flush()
    const repositoryElementPath = await first.getRepositoryElementPath(
      repository,
      RepositoryAppearanceElementId.Workspace
    )

    await writeFile(
      join(profilePath, 'setting.json'),
      JSON.stringify({
        version: 1,
        value: { toolbarLabels: 'icons', toolbarDensity: 42 },
      })
    )
    await writeFile(
      join(tabPath, 'setting.json'),
      JSON.stringify({ version: 1, value: { style: { fontSize: 'huge' } } })
    )
    await writeFile(
      join(repositoryElementPath, 'setting.json'),
      JSON.stringify({
        version: 1,
        value: { accentPalette: 42, surfacePalette: 'neutral' },
      })
    )

    const reopened = await createCoordinator(root)
    assert.deepEqual(
      reopened.getProfileElement(ProfileAppearanceElementId.Toolbar),
      { toolbarLabels: 'icons', toolbarDensity: 'compact' }
    )
    assert.deepEqual(
      await reopened.ensureTabTitleElement('recovery-tab', null),
      { style: { italic: true } }
    )
    assert.deepEqual(
      (await reopened.ensureRepositoryElements(repository, {}))[
        RepositoryAppearanceElementId.Workspace
      ],
      { accentPalette: 'violet', surfacePalette: 'neutral' }
    )
  })

  it('rejects a linked ancestor which redirects an element repository outside its profile root', async t => {
    const temp = await createTempDirectory(t)
    const root = join(temp, 'appearance-elements')
    const outside = join(temp, 'outside')
    await mkdir(outside)
    const coordinator = await createCoordinator(root)
    const profileElementPath = coordinator.getProfileRepositoryPath(
      ProfileAppearanceElementId.AppWorkspace
    )
    const profileRoot = resolve(profileElementPath, '..', '..')
    const featuresPath = join(profileRoot, 'features')
    await symlink(
      outside,
      featuresPath,
      process.platform === 'win32' ? 'junction' : 'dir'
    )

    await assert.rejects(
      coordinator.ensureFeatureElement('redirected-feature'),
      /escaped.*ownership root|symbolic link|reparse point/i
    )
    assert.deepEqual(await readdir(outside), [])
  })
})
