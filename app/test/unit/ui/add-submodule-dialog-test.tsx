import assert from 'node:assert'
import { afterEach, beforeEach, describe, it } from 'node:test'
import * as React from 'react'

import {
  IAPIFullRepository,
  IAPIOrganization,
  IAPIRepository,
} from '../../../src/lib/api'
import { IAddSubmoduleOptions } from '../../../src/lib/git'
import { IAccountRepositories } from '../../../src/lib/stores/api-repositories-store'
import { Account, getAccountKey } from '../../../src/models/account'
import { Repository } from '../../../src/models/repository'
import { Dispatcher } from '../../../src/ui/dispatcher'
import { AddSubmoduleDialog } from '../../../src/ui/repository-settings/add-submodule-dialog'
import { fireEvent, render, screen, waitFor } from '../../helpers/ui/render'
import { LanguageModeChangedEvent } from '../../../src/lib/i18n'

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
  localStorage.removeItem('language-mode-v1')
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
  localStorage.removeItem('appearance-customization-v1')
  localStorage.removeItem('language-mode-v1')
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

const organization: IAPIOrganization = {
  id: 19,
  login: 'material-org',
  avatar_url: 'https://example.invalid/org.png',
  url: 'https://api.github.com/orgs/material-org',
}

const createdRemote: IAPIFullRepository = {
  ...apiRepository,
  clone_url: 'https://github.com/material-org/new-component.git',
  ssh_url: 'git@github.com:material-org/new-component.git',
  html_url: 'https://github.com/material-org/new-component',
  name: 'new-component',
  owner: {
    ...apiRepository.owner,
    id: organization.id,
    login: organization.login,
    type: 'Organization',
  },
  parent: undefined,
}

function accountRepositories(
  repositories: ReadonlyArray<IAPIRepository>,
  organizations: ReadonlyArray<IAPIOrganization> = []
): IAccountRepositories {
  return {
    repositories,
    loading: false,
    error: null,
    organizations,
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
  it('reacts across Cantonese and semantic bilingual copy with one accessible action name', async () => {
    localStorage.setItem(
      'appearance-customization-v1',
      JSON.stringify({ version: 1, languageMode: 'cantonese' })
    )
    renderDialog({} as Dispatcher)

    assert.ok(screen.getByRole('dialog', { name: '新增子模組' }))
    fireEvent.click(screen.getByText('URL'))
    assert.ok(screen.getByLabelText('Repo URL'))
    assert.ok(screen.getByRole('button', { name: '新增子模組' }))

    document.dispatchEvent(
      new CustomEvent(LanguageModeChangedEvent, { detail: 'bilingual' })
    )
    await waitFor(() => {
      assert.ok(screen.getByRole('button', { name: 'Add submodule' }))
      assert.equal(
        screen.queryByRole('button', {
          name: 'Add submodule · 新增子模組',
        }),
        null
      )
      const title = document.querySelector('#add-submodule-title')
      assert.equal(
        title?.querySelector('[lang="en"]')?.textContent,
        'Add a submodule'
      )
      assert.equal(
        title?.querySelector('[lang="zh-HK"]')?.textContent,
        '新增子模組'
      )
    })
  })

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

  it('creates an initialized organization remote before adding its clone URL', async () => {
    const account = dotComAccount()
    const sequence = new Array<string>()
    const createCalls = new Array<{
      readonly account: Account
      readonly org: IAPIOrganization | null
      readonly name: string
      readonly description: string
      readonly private_: boolean
    }>()
    const addCalls = new Array<IAddCall>()
    const dispatcher = {
      createRemoteRepositoryForSubmodule: async (
        selectedAccount: Account,
        org: IAPIOrganization | null,
        name: string,
        description: string,
        private_: boolean
      ) => {
        sequence.push('create')
        createCalls.push({
          account: selectedAccount,
          org,
          name,
          description,
          private_,
        })
        return createdRemote
      },
      addSubmodule: async (
        _repository: Repository,
        url: string,
        path: string,
        branch?: string | null,
        options?: IAddSubmoduleOptions
      ) => {
        sequence.push('add')
        addCalls.push({ url, path, branch, options })
      },
    } as unknown as Dispatcher

    renderDialog(
      dispatcher,
      [account],
      new Map([[account, accountRepositories([], [organization])]])
    )
    fireEvent.click(screen.getByText('Create remote'))
    fireEvent.change(screen.getByLabelText('Owner'), {
      target: { value: 'org:material-org' },
    })
    fireEvent.change(screen.getByLabelText('Repository name'), {
      target: { value: 'new-component' },
    })
    fireEvent.change(screen.getByLabelText('Description (optional)'), {
      target: { value: 'Shared material component' },
    })

    await waitFor(() =>
      assert.equal(
        (screen.getByLabelText('Path inside repository') as HTMLInputElement)
          .value,
        'vendor/new-component'
      )
    )
    assert.equal(
      (
        screen.getByLabelText(
          'Keep this repository private'
        ) as HTMLInputElement
      ).checked,
      true
    )
    fireEvent.click(
      screen.getByRole('button', { name: 'Create and add submodule' })
    )

    await screen.findByText('Submodule added')
    assert.deepEqual(sequence, ['create', 'add'])
    assert.equal(createCalls.length, 1)
    assert.equal(createCalls[0].account, account)
    assert.equal(createCalls[0].org, organization)
    assert.equal(createCalls[0].name, 'new-component')
    assert.equal(createCalls[0].description, 'Shared material component')
    assert.equal(createCalls[0].private_, true)
    assert.equal(addCalls.length, 1)
    assert.equal(addCalls[0].url, createdRemote.clone_url)
    assert.equal(addCalls[0].path, 'vendor/new-component')
    assert.equal(addCalls[0].branch, null)
    assert.equal(addCalls[0].options?.accountKey, getAccountKey(account))
  })

  it('does not run Git or report success when remote creation fails', async () => {
    const account = dotComAccount()
    let addCalls = 0
    const dispatcher = {
      createRemoteRepositoryForSubmodule: async () => {
        throw new Error('name already exists')
      },
      addSubmodule: async () => {
        addCalls++
      },
    } as unknown as Dispatcher

    renderDialog(
      dispatcher,
      [account],
      new Map([[account, accountRepositories([])]])
    )
    fireEvent.click(screen.getByText('Create remote'))
    fireEvent.change(screen.getByLabelText('Repository name'), {
      target: { value: 'new-component' },
    })
    fireEvent.click(
      screen.getByRole('button', { name: 'Create and add submodule' })
    )

    assert.ok(
      await screen.findByText(
        /could not create the remote repository: name already exists/i
      )
    )
    assert.equal(addCalls, 0)
    assert.equal(screen.queryByText('Submodule added'), null)
  })

  it('aborts pending remote creation and never proceeds to Git', async () => {
    const account = dotComAccount()
    let creationSignal: AbortSignal | undefined
    let addCalls = 0
    const dispatcher = {
      createRemoteRepositoryForSubmodule: async (
        _account: Account,
        _org: IAPIOrganization | null,
        _name: string,
        _description: string,
        _private: boolean,
        signal?: AbortSignal
      ) => {
        creationSignal = signal
        return await new Promise<IAPIFullRepository>((_resolve, reject) => {
          signal?.addEventListener(
            'abort',
            () => reject(new DOMException('transport stopped', 'AbortError')),
            { once: true }
          )
        })
      },
      addSubmodule: async () => {
        addCalls++
      },
    } as unknown as Dispatcher

    renderDialog(
      dispatcher,
      [account],
      new Map([[account, accountRepositories([])]])
    )
    fireEvent.click(screen.getByText('Create remote'))
    fireEvent.change(screen.getByLabelText('Repository name'), {
      target: { value: 'new-component' },
    })
    fireEvent.click(
      screen.getByRole('button', { name: 'Create and add submodule' })
    )

    const cancel = await screen.findByRole('button', {
      name: 'Cancel operation',
    })
    assert.equal(creationSignal?.aborted, false)
    fireEvent.click(cancel)

    await waitFor(() => assert.equal(creationSignal?.aborted, true))
    assert.ok(
      await screen.findByText(
        /remote host may still have created the repository/i
      )
    )
    assert.equal(addCalls, 0)
    assert.equal(screen.queryByText('Submodule added'), null)
  })

  it('fails closed when the selected organization disappears before submit', async () => {
    const account = dotComAccount()
    let createCalls = 0
    const dispatcher = {
      createRemoteRepositoryForSubmodule: async () => {
        createCalls++
        return createdRemote
      },
    } as unknown as Dispatcher
    const props = {
      repository,
      dispatcher,
      accounts: [account],
      apiRepositories: new Map([
        [account, accountRepositories([], [organization])],
      ]),
      onRefreshRepositories: () => undefined,
      onAdded: () => undefined,
      onDismissed: () => undefined,
    }
    const view = render(<AddSubmoduleDialog {...props} />)
    fireEvent.click(screen.getByText('Create remote'))
    fireEvent.change(screen.getByLabelText('Owner'), {
      target: { value: 'org:material-org' },
    })
    fireEvent.change(screen.getByLabelText('Repository name'), {
      target: { value: 'new-component' },
    })

    view.rerender(
      <AddSubmoduleDialog
        {...props}
        apiRepositories={new Map([[account, accountRepositories([])]])}
      />
    )

    assert.ok(screen.getByText(/selected organization is no longer available/i))
    const submit = screen.getByRole('button', {
      name: 'Create and add submodule',
    })
    assert.equal(submit.getAttribute('aria-disabled'), 'true')
    fireEvent.click(submit)
    assert.equal(createCalls, 0)
  })

  it('fails closed when the selected remote account disappears before submit', async () => {
    const accountA = dotComAccount()
    const accountB = new Account(
      'backup-tester',
      'https://api.github.com',
      'backup-token',
      [],
      'Backup Tester',
      8,
      'Backup Tester',
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      'github'
    )
    const createAccounts = new Array<Account>()
    let addCalls = 0
    const dispatcher = {
      createRemoteRepositoryForSubmodule: async (account: Account) => {
        createAccounts.push(account)
        return createdRemote
      },
      addSubmodule: async () => {
        addCalls++
      },
    } as unknown as Dispatcher
    const props = {
      repository,
      dispatcher,
      accounts: [accountB, accountA],
      apiRepositories: new Map([
        [accountA, accountRepositories([])],
        [accountB, accountRepositories([])],
      ]),
      onRefreshRepositories: () => undefined,
      onAdded: () => undefined,
      onDismissed: () => undefined,
    }
    const view = render(<AddSubmoduleDialog {...props} />)
    fireEvent.click(screen.getByText('Create remote'))
    fireEvent.click(screen.getByLabelText('Account'))
    const accountFilter = screen.getByLabelText('Filter Accounts')
    fireEvent.change(accountFilter, { target: { value: 'material-tester' } })
    fireEvent.keyDown(accountFilter, { key: 'Enter', code: 'Enter' })
    assert.match(
      screen.getByLabelText('Account').textContent ?? '',
      /@material-tester/
    )
    fireEvent.change(screen.getByLabelText('Repository name'), {
      target: { value: 'new-component' },
    })

    view.rerender(
      <AddSubmoduleDialog
        {...props}
        accounts={[accountB]}
        apiRepositories={new Map([[accountB, accountRepositories([])]])}
      />
    )

    const submit = screen.getByRole('button', {
      name: 'Create and add submodule',
    })
    assert.equal(submit.getAttribute('aria-disabled'), 'true')
    fireEvent.click(submit)
    assert.deepEqual(createAccounts, [])
    assert.equal(addCalls, 0)
  })

  it('retries an already-created remote without creating a duplicate', async () => {
    const account = dotComAccount()
    let createCalls = 0
    let addCalls = 0
    const dispatcher = {
      createRemoteRepositoryForSubmodule: async () => {
        createCalls++
        return createdRemote
      },
      addSubmodule: async () => {
        addCalls++
        if (addCalls === 1) {
          throw new Error('checkout path is temporarily locked')
        }
      },
    } as unknown as Dispatcher

    renderDialog(
      dispatcher,
      [account],
      new Map([[account, accountRepositories([])]])
    )
    fireEvent.click(screen.getByText('Create remote'))
    fireEvent.change(screen.getByLabelText('Repository name'), {
      target: { value: 'new-component' },
    })
    fireEvent.click(
      screen.getByRole('button', { name: 'Create and add submodule' })
    )

    assert.ok(
      await screen.findByText(
        /remote repository was created at .*new-component/i
      )
    )
    assert.ok(screen.getByText('Remote repository created'))
    assert.equal(createCalls, 1)
    assert.equal(addCalls, 1)

    fireEvent.click(
      screen.getByRole('button', { name: 'Create and add submodule' })
    )
    await screen.findByText('Submodule added')
    assert.equal(createCalls, 1)
    assert.equal(addCalls, 2)
  })
})
