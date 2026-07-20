import assert from 'node:assert'
import { afterEach, beforeEach, describe, it } from 'node:test'
import { mkdir } from 'fs/promises'
import * as Path from 'path'
import * as React from 'react'
import { exec } from 'dugite'

import { Repository } from '../../../src/models/repository'
import { AddExistingRepository } from '../../../src/ui/add-repository/add-existing-repository'
import { Dispatcher } from '../../../src/ui/dispatcher'
import {
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from '../../helpers/ui/render'
import { createTempDirectory } from '../../helpers/temp'

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

afterEach(() => {
  restoreIpcSend?.()
  restoreDialogShow?.()
})

class TestDispatcher {
  public readonly addCalls = new Array<ReadonlyArray<string>>()
  public readonly selectedRepositories = new Array<Repository>()
  public closeFoldoutCount = 0
  public recordAddCount = 0

  public async addRepositories(paths: ReadonlyArray<string>) {
    this.addCalls.push(paths)
    return paths.map(
      (path, index) => new Repository(path, index + 1, null, false)
    )
  }

  public closeFoldout() {
    this.closeFoldoutCount++
  }

  public selectRepository(repository: Repository) {
    this.selectedRepositories.push(repository)
  }

  public recordAddExistingRepository() {
    this.recordAddCount++
  }
}

const asDispatcher = (dispatcher: TestDispatcher) =>
  dispatcher as unknown as Dispatcher

describe('AddExistingRepository folder detection', () => {
  it('previews and adds all repositories detected in a chosen folder', async t => {
    const scanRootPath = await createTempDirectory(t)
    const firstRepositoryPath = Path.join(scanRootPath, 'alpha')
    const secondRepositoryPath = Path.join(scanRootPath, 'team', 'beta')
    const dispatcher = new TestDispatcher()
    let dismissed = 0
    let scannedPath: string | null = null

    render(
      <AddExistingRepository
        dispatcher={asDispatcher(dispatcher)}
        onDismissed={() => dismissed++}
        chooseRepositoryFolder={async () => scanRootPath}
        scanRepositoryFolder={async path => {
          scannedPath = path
          return {
            repositories: [firstRepositoryPath, secondRepositoryPath],
            truncated: false,
          }
        }}
      />
    )

    fireEvent.click(
      screen.getByRole('button', { name: 'Auto-detect repositories...' })
    )

    await screen.findByText('Found 2 Git repositories')
    assert.equal(scannedPath, Path.resolve(scanRootPath))
    assert.equal(
      (screen.getByPlaceholderText('repository path') as HTMLInputElement)
        .value,
      scanRootPath
    )

    const detectedList = screen.getByRole('list', {
      name: 'Detected Git repositories',
    })
    assert.ok(within(detectedList).getByText('alpha'))
    assert.ok(within(detectedList).getByText(Path.join('team', 'beta')))

    fireEvent.change(screen.getByPlaceholderText('repository path'), {
      target: { value: Path.join(scanRootPath, 'manually-entered') },
    })
    assert.equal(screen.queryByText('Found 2 Git repositories'), null)
    assert.ok(screen.getByRole('button', { name: /^Add repository$/i }))

    fireEvent.click(
      screen.getByRole('button', { name: 'Auto-detect repositories...' })
    )
    await screen.findByText('Found 2 Git repositories')

    fireEvent.click(screen.getByRole('button', { name: 'Add 2 repositories' }))

    await waitFor(() => assert.equal(dispatcher.addCalls.length, 1))
    assert.deepEqual(dispatcher.addCalls[0], [
      firstRepositoryPath,
      secondRepositoryPath,
    ])
    assert.equal(dismissed, 1)
    assert.equal(dispatcher.closeFoldoutCount, 1)
    assert.equal(dispatcher.recordAddCount, 1)
    assert.equal(dispatcher.selectedRepositories[0]?.path, firstRepositoryPath)
  })

  it('keeps the original single-repository path workflow', async t => {
    const repositoryPath = await createTempDirectory(t)
    await mkdir(repositoryPath, { recursive: true })
    const initResult = await exec(['init'], repositoryPath)
    assert.equal(initResult.exitCode, 0, initResult.stderr)

    const dispatcher = new TestDispatcher()
    let dismissed = 0
    render(
      <AddExistingRepository
        dispatcher={asDispatcher(dispatcher)}
        onDismissed={() => dismissed++}
        path={repositoryPath}
      />
    )

    fireEvent.click(screen.getByRole('button', { name: /^Add repository$/i }))

    await waitFor(() => assert.equal(dispatcher.addCalls.length, 1))
    assert.deepEqual(dispatcher.addCalls[0], [Path.resolve(repositoryPath)])
    assert.equal(dismissed, 1)
    assert.equal(dispatcher.selectedRepositories[0]?.path, repositoryPath)
  })

  it('does not submit an empty bounded scan', async t => {
    const scanRootPath = await createTempDirectory(t)
    const dispatcher = new TestDispatcher()

    render(
      <AddExistingRepository
        dispatcher={asDispatcher(dispatcher)}
        onDismissed={() => undefined}
        chooseRepositoryFolder={async () => scanRootPath}
        scanRepositoryFolder={async () => ({
          repositories: [],
          truncated: true,
        })}
      />
    )

    fireEvent.click(
      screen.getByRole('button', { name: 'Auto-detect repositories...' })
    )

    await screen.findByText(
      'No Git repositories were found in the folders that could be scanned. Some folders could not be read or safe scan limits were reached.'
    )
    const addButton = screen.getByRole('button', {
      name: /^Add repository$/i,
    })
    assert.equal(addButton.getAttribute('aria-disabled'), 'true')
    fireEvent.click(addButton)
    assert.equal(dispatcher.addCalls.length, 0)
  })

  it('settles a rejected scan and clears its accessible error after a path edit', async t => {
    const scanRootPath = await createTempDirectory(t)
    const dispatcher = new TestDispatcher()

    render(
      <AddExistingRepository
        dispatcher={asDispatcher(dispatcher)}
        onDismissed={() => undefined}
        chooseRepositoryFolder={async () => scanRootPath}
        scanRepositoryFolder={async () => {
          throw new Error('synthetic unreadable folder')
        }}
      />
    )

    fireEvent.click(
      screen.getByRole('button', { name: 'Auto-detect repositories...' })
    )

    const error = await screen.findByRole('alert')
    assert.equal(
      error.textContent,
      "Desktop Material couldn't scan this folder. Check that it can be read and try again."
    )
    assert.equal(
      screen
        .getByRole('button', { name: 'Auto-detect repositories...' })
        .getAttribute('aria-disabled'),
      null
    )

    fireEvent.change(screen.getByPlaceholderText('repository path'), {
      target: { value: Path.join(scanRootPath, 'manual') },
    })
    assert.equal(screen.queryByRole('alert'), null)
    assert.equal(dispatcher.addCalls.length, 0)
  })
})
