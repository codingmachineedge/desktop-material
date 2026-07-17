import assert from 'node:assert'
import { afterEach, beforeEach, describe, it } from 'node:test'
import * as React from 'react'

import { IAPIRepository } from '../../../src/lib/api'
import { IAddSubmoduleOptions } from '../../../src/lib/git'
import { IAccountRepositories } from '../../../src/lib/stores/api-repositories-store'
import { Account, getAccountKey } from '../../../src/models/account'
import { Repository } from '../../../src/models/repository'
import { Dispatcher } from '../../../src/ui/dispatcher'
import { AddSubmoduleDialog } from '../../../src/ui/repository-settings/add-submodule-dialog'
import { fireEvent, render, screen, waitFor } from '../../helpers/ui/render'

let restoreIpcSend: (() => void) | null = null
let restoreDialogShow: (() => void) | null = null
let restoreWindowResizeObserver: (() => void) | null = null

class DialogResizeObserver implements ResizeObserver {
  public constructor(private readonly callback: ResizeObserverCallback) {}

  public observe(target: Element) {
    const width = 720
    const height = 280
    Object.defineProperty(target, 'offsetWidth', {
      configurable: true,
      value: width,
    })
    Object.defineProperty(target, 'offsetHeight', {
      configurable: true,
      value: height,
    })
    this.callback(
      [
        {
          target,
          contentRect: {
            x: 0,
            y: 0,
            width,
            height,
            top: 0,
            right: width,
            bottom: height,
            left: 0,
            toJSON: () => ({}),
          },
          borderBoxSize: [],
          contentBoxSize: [],
          devicePixelContentBoxSize: [],
        },
      ],
      this
    )
  }

  public unobserve() {}
  public disconnect() {}
}

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

  const previousGlobalResizeObserver = globalThis.ResizeObserver
  const previousResizeObserver = window.ResizeObserver
  Object.assign(globalThis, { ResizeObserver: DialogResizeObserver })
  Object.assign(window, { ResizeObserver: DialogResizeObserver })
  restoreWindowResizeObserver = () => {
    Object.assign(globalThis, {
      ResizeObserver: previousGlobalResizeObserver,
    })
    Object.assign(window, { ResizeObserver: previousResizeObserver })
    restoreWindowResizeObserver = null
  }
})

afterEach(() => {
  restoreIpcSend?.()
  restoreDialogShow?.()
  restoreWindowResizeObserver?.()
})

const repository = new Repository('C:/fixtures/superproject', 1, null, false)

interface IAddCall {
  readonly url: string
  readonly path: string
  readonly branch: string | null | undefined
  readonly options: IAddSubmoduleOptions | undefined
}

function dotComAccount() {
  return new Account(
    'material-tester',
    'https://api.github.com',
    'synthetic-token',
    [],
    'Material Tester',
    7,
    'Material Tester',
    undefined,
    undefined,
    undefined,
    undefined,
    undefined,
    'github'
  )
}

const apiRepository: IAPIRepository = {
  clone_url: 'https://github.com/material-tester/shared-ui.git',
  ssh_url: 'git@github.com:material-tester/shared-ui.git',
  html_url: 'https://github.com/material-tester/shared-ui',
  name: 'shared-ui',
  owner: {
    id: 7,
    login: 'material-tester',
    avatar_url: 'https://example.invalid/avatar.png',
    html_url: 'https://github.com/material-tester',
    type: 'User',
  },
  private: true,
  fork: false,
  default_branch: 'main',
  pushed_at: '2026-07-16T12:00:00Z',
  has_issues: true,
  archived: false,
}

function accountRepositories(
  repositories: ReadonlyArray<IAPIRepository>
): IAccountRepositories {
  return {
    repositories,
    loading: false,
    error: null,
    organizations: [],
    organizationsLoading: false,
    organizationRepositories: new Map(),
  }
}

function renderDialog(
  dispatcher: Dispatcher,
  accounts: ReadonlyArray<Account> = [],
  apiRepositories: ReadonlyMap<Account, IAccountRepositories> = new Map(),
  onAdded: () => void | Promise<void> = () => undefined
) {
  return render(
    <AddSubmoduleDialog
      repository={repository}
      dispatcher={dispatcher}
      accounts={accounts}
      apiRepositories={apiRepositories}
      onRefreshRepositories={() => undefined}
      onAdded={onAdded}
      onDismissed={() => undefined}
    />
  )
}

function chooseUrlAndFillSource() {
  fireEvent.click(screen.getByText('URL'))
  fireEvent.change(screen.getByLabelText('Repository URL'), {
    target: { value: 'https://github.com/example/shared-library.git' },
  })
}

describe('Clone-style Add Submodule dialog', () => {
  it('exposes all provider tabs, live path suggestion, review, and validation', () => {
    renderDialog({} as Dispatcher)

    assert.ok(screen.getByText('GitHub.com'))
    assert.ok(screen.getByText('GitHub Enterprise'))
    assert.ok(screen.getByText('GitLab & Bitbucket'))
    chooseUrlAndFillSource()

    assert.equal(
      (screen.getByLabelText('Path inside repository') as HTMLInputElement)
        .value,
      'vendor/shared-library'
    )
    assert.ok(screen.getByRole('region', { name: 'Submodule review' }))

    fireEvent.change(screen.getByLabelText('Branch (optional)'), {
      target: { value: 'feature..invalid' },
    })
    assert.equal(
      screen
        .getByRole('button', { name: 'Add submodule' })
        .getAttribute('aria-disabled'),
      'true'
    )
    assert.ok(screen.getByText(/Enter a valid branch name/))
  })

  it('routes the reviewed URL/path/branch through progress to success', async () => {
    const calls = new Array<IAddCall>()
    let refreshed = 0
    const dispatcher = {
      addSubmodule: async (
        _repository: Repository,
        url: string,
        path: string,
        branch?: string | null,
        options?: IAddSubmoduleOptions
      ) => {
        calls.push({ url, path, branch, options })
        options?.onProgress?.('Receiving objects: 75%', 0.75)
      },
    } as unknown as Dispatcher

    renderDialog(dispatcher, [], new Map(), () => {
      refreshed++
    })
    chooseUrlAndFillSource()
    fireEvent.change(screen.getByLabelText('Branch (optional)'), {
      target: { value: 'stable' },
    })
    fireEvent.click(screen.getByRole('button', { name: 'Add submodule' }))

    await screen.findByText('Submodule added')
    assert.equal(calls.length, 1)
    assert.equal(calls[0].url, 'https://github.com/example/shared-library.git')
    assert.equal(calls[0].path, 'vendor/shared-library')
    assert.equal(calls[0].branch, 'stable')
    assert.equal(refreshed, 1)
    assert.ok(screen.getByRole('button', { name: 'Done' }))
  })

  it('keeps cancellation available while Git is running', async () => {
    let signal: AbortSignal | undefined
    const dispatcher = {
      addSubmodule: (
        _repository: Repository,
        _url: string,
        _path: string,
        _branch?: string | null,
        options?: IAddSubmoduleOptions
      ) => {
        signal = options?.signal
        return new Promise<void>((_resolve, reject) => {
          signal?.addEventListener('abort', () => reject(new Error('killed')))
        })
      },
    } as unknown as Dispatcher

    renderDialog(dispatcher)
    chooseUrlAndFillSource()
    fireEvent.click(screen.getByRole('button', { name: 'Add submodule' }))
    const cancel = await screen.findByRole('button', {
      name: 'Cancel operation',
    })
    assert.equal(screen.getByRole('tabpanel').getAttribute('aria-busy'), 'true')
    fireEvent.click(cancel)

    await waitFor(() => assert.equal(signal?.aborted, true))
    assert.ok(await screen.findByText(/Adding the submodule was cancelled/))
  })

  it('preserves the exact hosted account credential affinity', async () => {
    const account = dotComAccount()
    const calls = new Array<IAddCall>()
    const dispatcher = {
      addSubmodule: async (
        _repository: Repository,
        url: string,
        path: string,
        branch?: string | null,
        options?: IAddSubmoduleOptions
      ) => calls.push({ url, path, branch, options }),
    } as unknown as Dispatcher

    renderDialog(
      dispatcher,
      [account],
      new Map([[account, accountRepositories([apiRepository])]])
    )
    const item = await screen.findByText('material-tester/shared-ui')
    fireEvent.mouseDown(item)
    fireEvent.mouseUp(item)
    fireEvent.click(item)
    await waitFor(() =>
      assert.equal(
        (screen.getByLabelText('Path inside repository') as HTMLInputElement)
          .value,
        'vendor/shared-ui'
      )
    )
    const add = screen.getByRole('button', { name: 'Add submodule' })
    assert.notEqual(add.getAttribute('aria-disabled'), 'true')
    fireEvent.click(add)

    await screen.findByText('Submodule added')
    assert.equal(calls.length, 1)
    assert.equal(calls[0].url, apiRepository.clone_url)
    assert.equal(calls[0].path, 'vendor/shared-ui')
    assert.equal(calls[0].options?.accountKey, getAccountKey(account))
  })
})
