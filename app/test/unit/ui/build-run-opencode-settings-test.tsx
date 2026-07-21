import assert from 'node:assert'
import { describe, it } from 'node:test'
import * as React from 'react'
import { Repository } from '../../../src/models/repository'
import {
  IBuildRunPreferences,
  defaultBuildRunPreferences,
} from '../../../src/models/build-run-preferences'
import { BuildRunSettings } from '../../../src/ui/repository-settings/build-run-settings'
import { fireEvent, render, screen } from '../../helpers/ui/render'

const repository = () =>
  new Repository('C:/opencode-repo', 1, null, false, null, {}, false)

describe('Build & Run opencode preferences', () => {
  it('defaults the offer on and auto-approve (yolo) off', () => {
    assert.equal(defaultBuildRunPreferences.offerOpencodeAutoFix, true)
    assert.equal(defaultBuildRunPreferences.opencodeAutoApprove, false)
    assert.equal(defaultBuildRunPreferences.buildFixAutoApprove, false)
    assert.equal(defaultBuildRunPreferences.buildFixProvider, 'opencode')
  })

  it('toggles offerOpencodeAutoFix through the settings checkbox', () => {
    const changes: IBuildRunPreferences[] = []
    // Start from an explicitly-disabled offer so clicking enables it.
    render(
      <BuildRunSettings
        repository={repository()}
        preferences={{
          ...defaultBuildRunPreferences,
          offerOpencodeAutoFix: false,
        }}
        onPreferencesChanged={p => changes.push(p)}
      />
    )

    const checkbox = screen.getByRole('checkbox', {
      name: /offer opencode to fix build errors/i,
    })
    fireEvent.click(checkbox)

    assert.equal(changes.length, 1)
    assert.equal(changes[0].offerOpencodeAutoFix, true)
    // The auto-approve toggle must not ride along with the offer toggle.
    assert.equal(changes[0].opencodeAutoApprove, false)
  })

  it('toggles opencodeAutoApprove through the yolo checkbox', () => {
    const changes: IBuildRunPreferences[] = []
    render(
      <BuildRunSettings
        repository={repository()}
        preferences={defaultBuildRunPreferences}
        onPreferencesChanged={p => changes.push(p)}
      />
    )

    const checkbox = screen.getByRole('checkbox', {
      name: /auto-approve opencode in this repository/i,
    })
    fireEvent.click(checkbox)

    assert.equal(changes.length, 1)
    assert.equal(changes[0].opencodeAutoApprove, true)
    assert.equal(changes[0].buildFixAutoApprove, true)
    // The yolo toggle must not disturb the offer, which defaults on.
    assert.equal(changes[0].offerOpencodeAutoFix, true)
  })

  it('persists the selected Codex provider without changing consent', () => {
    const changes: IBuildRunPreferences[] = []
    render(
      <BuildRunSettings
        repository={repository()}
        preferences={defaultBuildRunPreferences}
        onPreferencesChanged={p => changes.push(p)}
      />
    )

    fireEvent.change(
      screen.getByLabelText<HTMLSelectElement>(/preferred build-fix provider/i),
      { target: { value: 'codex' } }
    )

    assert.equal(changes.length, 1)
    assert.equal(changes[0].buildFixProvider, 'codex')
    assert.equal(changes[0].buildFixAutoApprove, false)
  })

  it('renders both checkboxes reflecting the persisted preferences', () => {
    render(
      <BuildRunSettings
        repository={repository()}
        preferences={{
          ...defaultBuildRunPreferences,
          offerOpencodeAutoFix: true,
          buildFixAutoApprove: true,
          opencodeAutoApprove: true,
        }}
        onPreferencesChanged={() => {}}
      />
    )

    const offer = screen.getByRole<HTMLInputElement>('checkbox', {
      name: /offer opencode to fix build errors/i,
    })
    const yolo = screen.getByRole<HTMLInputElement>('checkbox', {
      name: /auto-approve opencode in this repository/i,
    })
    assert.equal(offer.checked, true)
    assert.equal(yolo.checked, true)
  })
})
