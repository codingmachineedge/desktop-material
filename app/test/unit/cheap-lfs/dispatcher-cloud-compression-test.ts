import assert from 'node:assert'
import { describe, it } from 'node:test'

import type { IEnsureCheapLfsCloudCompressionResult } from '../../../src/lib/cheap-lfs/cloud-compression'
import {
  defaultBuildRunPreferences,
  IBuildRunPreferences,
} from '../../../src/models/build-run-preferences'
import { GitHubRepository } from '../../../src/models/github-repository'
import { Owner } from '../../../src/models/owner'
import { Repository } from '../../../src/models/repository'
import { Dispatcher } from '../../../src/ui/dispatcher'

interface IPreferenceCall {
  readonly repository: Repository
  readonly preferences: IBuildRunPreferences
}

function repositoryWithPreferences(
  isPrivate: boolean,
  preferences: IBuildRunPreferences = defaultBuildRunPreferences
): Repository {
  return new Repository(
    'C:\\cheap-lfs-dispatcher',
    41,
    new GitHubRepository(
      'cheap-lfs-dispatcher',
      new Owner('desktop', 'https://api.github.com', 41),
      41,
      isPrivate
    ),
    false,
    null,
    {},
    false,
    undefined,
    null,
    preferences
  )
}

function createHarness(result: IEnsureCheapLfsCloudCompressionResult) {
  const persistenceCalls = new Array<IPreferenceCall>()
  const ensureCalls = new Array<IPreferenceCall>()
  const dispatcher = Object.create(Dispatcher.prototype) as Dispatcher
  Reflect.set(dispatcher, 'appStore', {
    async _updateRepositoryBuildRunPreferences(
      repository: Repository,
      preferences: IBuildRunPreferences
    ): Promise<void> {
      persistenceCalls.push({ repository, preferences })
    },
    async _ensureCheapLfsCloudCompressionWorkflow(
      repository: Repository,
      preferences: IBuildRunPreferences
    ): Promise<IEnsureCheapLfsCloudCompressionResult> {
      ensureCalls.push({ repository, preferences })
      return result
    },
  })
  return { dispatcher, persistenceCalls, ensureCalls }
}

describe('Dispatcher Cheap LFS cloud-compression preference routing', () => {
  it('does not manage a public workflow for an unrelated preference change', async () => {
    const repository = repositoryWithPreferences(false)
    const preferences = { ...defaultBuildRunPreferences, elevated: true }
    const result: IEnsureCheapLfsCloudCompressionResult = {
      path: 'C:\\cheap-lfs-dispatcher\\.github\\workflows\\cheap-lfs.yml',
      changed: true,
      policy: 'automatic-public',
    }
    const harness = createHarness(result)

    const updateResult =
      await harness.dispatcher.updateRepositoryBuildRunPreferences(
        repository,
        preferences
      )

    assert.equal(updateResult, null)
    assert.deepEqual(harness.persistenceCalls, [{ repository, preferences }])
    assert.equal(harness.ensureCalls.length, 0)
  })

  it('returns the single workflow result for a private opt-in change', async () => {
    const repository = repositoryWithPreferences(true)
    const preferences = {
      ...defaultBuildRunPreferences,
      cheapLfsCloudCompression: true,
    }
    const result: IEnsureCheapLfsCloudCompressionResult = {
      path: 'C:\\cheap-lfs-dispatcher\\.github\\workflows\\cheap-lfs.yml',
      changed: true,
      policy: 'enabled-private',
    }
    const harness = createHarness(result)

    const updateResult =
      await harness.dispatcher.updateRepositoryBuildRunPreferences(
        repository,
        preferences
      )

    assert.strictEqual(updateResult, result)
    assert.deepEqual(harness.persistenceCalls, [{ repository, preferences }])
    assert.deepEqual(harness.ensureCalls, [{ repository, preferences }])
  })
})
