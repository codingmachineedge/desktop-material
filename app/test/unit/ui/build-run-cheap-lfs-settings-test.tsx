import assert from 'node:assert'
import { describe, it } from 'node:test'
import * as React from 'react'
import { Repository } from '../../../src/models/repository'
import { GitHubRepository } from '../../../src/models/github-repository'
import { Owner } from '../../../src/models/owner'
import {
  IBuildRunPreferences,
  defaultBuildRunPreferences,
} from '../../../src/models/build-run-preferences'
import { BuildRunSettings } from '../../../src/ui/repository-settings/build-run-settings'
import { fireEvent, render, screen } from '../../helpers/ui/render'

const repository = () =>
  new Repository('C:/cheap-lfs-repo', 1, null, false, null, {}, false)

const githubRepository = (isPrivate: boolean | null) =>
  new Repository(
    'C:/cheap-lfs-repo',
    1,
    new GitHubRepository(
      'cheap-lfs-repo',
      new Owner('desktop', 'https://api.github.com', 1),
      1,
      isPrivate
    ),
    false
  )

describe('Build & Run cheap-LFS preferences', () => {
  it('defaults both automation toggles on', () => {
    assert.equal(defaultBuildRunPreferences.autoMaterializeCheapLfs, true)
    assert.equal(defaultBuildRunPreferences.autoPinLargeFilesOnCommit, true)
  })

  it('toggles autoMaterializeCheapLfs through the settings checkbox', () => {
    const changes: IBuildRunPreferences[] = []
    render(
      <BuildRunSettings
        repository={repository()}
        preferences={{
          ...defaultBuildRunPreferences,
          autoMaterializeCheapLfs: false,
        }}
        onPreferencesChanged={p => changes.push(p)}
      />
    )

    const checkbox = screen.getByRole('checkbox', {
      name: /download large files after cloning/i,
    })
    fireEvent.click(checkbox)

    assert.equal(changes.length, 1)
    assert.equal(changes[0].autoMaterializeCheapLfs, true)
    // The pin toggle must not ride along with the materialize toggle.
    assert.equal(changes[0].autoPinLargeFilesOnCommit, true)
  })

  it('toggles autoPinLargeFilesOnCommit through the settings checkbox', () => {
    const changes: IBuildRunPreferences[] = []
    render(
      <BuildRunSettings
        repository={repository()}
        preferences={{
          ...defaultBuildRunPreferences,
          autoPinLargeFilesOnCommit: false,
        }}
        onPreferencesChanged={p => changes.push(p)}
      />
    )

    const checkbox = screen.getByRole('checkbox', {
      name: /pin large files to a release when committing/i,
    })
    fireEvent.click(checkbox)

    assert.equal(changes.length, 1)
    assert.equal(changes[0].autoPinLargeFilesOnCommit, true)
    assert.equal(changes[0].autoMaterializeCheapLfs, true)
  })

  it('renders both checkboxes reflecting the persisted preferences', () => {
    render(
      <BuildRunSettings
        repository={repository()}
        preferences={{
          ...defaultBuildRunPreferences,
          autoMaterializeCheapLfs: false,
          autoPinLargeFilesOnCommit: true,
        }}
        onPreferencesChanged={() => {}}
      />
    )

    const materialize = screen.getByRole<HTMLInputElement>('checkbox', {
      name: /download large files after cloning/i,
    })
    const pin = screen.getByRole<HTMLInputElement>('checkbox', {
      name: /pin large files to a release when committing/i,
    })
    assert.equal(materialize.checked, false)
    assert.equal(pin.checked, true)
  })

  it('shows confirmed-public cloud compression as automatic', () => {
    render(
      <BuildRunSettings
        repository={githubRepository(false)}
        preferences={defaultBuildRunPreferences}
        onPreferencesChanged={() => {}}
      />
    )

    const checkbox = screen.getByRole<HTMLInputElement>('checkbox', {
      name: /automatic for public repositories/i,
    })
    assert.equal(checkbox.checked, true)
    assert.equal(checkbox.disabled, true)
  })

  it('persists explicit private-repository cloud-compression consent', () => {
    const changes: IBuildRunPreferences[] = []
    render(
      <BuildRunSettings
        repository={githubRepository(true)}
        preferences={defaultBuildRunPreferences}
        onPreferencesChanged={preference => changes.push(preference)}
      />
    )

    const checkbox = screen.getByRole<HTMLInputElement>('checkbox', {
      name: /enable cloud compression for this private repository/i,
    })
    assert.equal(checkbox.checked, false)
    fireEvent.click(checkbox)
    assert.equal(changes.at(-1)?.cheapLfsCloudCompression, true)
  })

  it('fails closed when repository visibility is unknown', () => {
    render(
      <BuildRunSettings
        repository={githubRepository(null)}
        preferences={{
          ...defaultBuildRunPreferences,
          cheapLfsCloudCompression: true,
        }}
        onPreferencesChanged={() => {}}
      />
    )

    const checkbox = screen.getByRole<HTMLInputElement>('checkbox', {
      name: /enable cloud compression for this private repository/i,
    })
    assert.equal(checkbox.checked, false)
    assert.equal(checkbox.disabled, true)
  })
})
