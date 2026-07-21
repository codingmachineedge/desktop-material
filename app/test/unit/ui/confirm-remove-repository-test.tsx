import assert from 'node:assert'
import { afterEach, beforeEach, describe, it } from 'node:test'
import * as React from 'react'

import { Repository } from '../../../src/models/repository'
import { RemoveRepositoryResult } from '../../../src/models/remove-repository-result'
import { ConfirmRemoveRepository } from '../../../src/ui/remove-repository'
import { fireEvent, render, waitFor } from '../../helpers/ui/render'

const repository = new Repository('/work/material', 7, null, false)

// The Dialog shell talks to the main process on mount; stub the renderer IPC
// send so the confirmation dialog can mount under jsdom. The dialog renders its
// content inside a modal <dialog>, so the assertions here read the DOM via
// container queries rather than Testing Library's visibility-filtered role
// queries.
let restoreIpcSend: (() => void) | null = null

beforeEach(async () => {
  const electron = await import('electron')
  const previousSend = electron.ipcRenderer.send
  electron.ipcRenderer.send = () => undefined
  restoreIpcSend = () => {
    electron.ipcRenderer.send = previousSend
    restoreIpcSend = null
  }
})

afterEach(() => {
  restoreIpcSend?.()
})

function submit(container: HTMLElement) {
  const form = container.querySelector('form')
  assert.notEqual(form, null)
  fireEvent.submit(form!)
}

describe('ConfirmRemoveRepository force-delete fallback', () => {
  it('dismisses without offering force delete when removal succeeds', async () => {
    let dismissed = 0
    let forceDeleted = 0
    const view = render(
      <ConfirmRemoveRepository
        repository={repository}
        onConfirmation={async () => 'removed' as RemoveRepositoryResult}
        onForceDelete={async () => {
          forceDeleted++
        }}
        onDismissed={() => dismissed++}
      />
    )

    submit(view.container)

    await waitFor(() => assert.equal(dismissed, 1))
    assert.equal(forceDeleted, 0)
    assert.ok(!view.container.textContent?.includes('Force delete permanently'))
  })

  it('surfaces the force-delete fallback when the trash step fails and permanently deletes the contained path', async () => {
    let dismissed = 0
    const confirmations: Array<{ path: string; deleteFromDisk: boolean }> = []
    const forceDeletedPaths: string[] = []

    const view = render(
      <ConfirmRemoveRepository
        repository={repository}
        onConfirmation={async (repo, deleteFromDisk) => {
          confirmations.push({ path: repo.path, deleteFromDisk })
          return 'trash-failed' as RemoveRepositoryResult
        }}
        onForceDelete={async repo => {
          forceDeletedPaths.push(repo.path)
        }}
        onDismissed={() => dismissed++}
      />
    )

    // Opt into removing the files from disk, then confirm.
    const checkbox = view.container.querySelector<HTMLInputElement>(
      'input[type="checkbox"]'
    )
    assert.notEqual(checkbox, null)
    fireEvent.click(checkbox!)
    submit(view.container)

    // The dialog stays open and surfaces the clearly-warned fallback.
    await waitFor(() =>
      assert.ok(
        view.container.textContent?.includes('Force delete permanently')
      )
    )
    assert.ok(
      view.container.textContent?.includes(
        'Force delete permanently removes the folder'
      )
    )
    assert.equal(dismissed, 0)
    assert.deepEqual(confirmations, [
      { path: repository.path, deleteFromDisk: true },
    ])

    // Confirming the fallback permanently deletes exactly the repo path and
    // then dismisses.
    submit(view.container)

    await waitFor(() => assert.equal(dismissed, 1))
    assert.deepEqual(forceDeletedPaths, [repository.path])
  })
})
