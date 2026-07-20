import assert from 'node:assert'
import { afterEach, beforeEach, describe, it } from 'node:test'
import * as React from 'react'

import { IManagedSubmodule, SubmoduleConfigKey } from '../../../src/lib/git'
import { Repository } from '../../../src/models/repository'
import { Dispatcher } from '../../../src/ui/dispatcher'
import { SubmoduleConfigDialog } from '../../../src/ui/submodules/submodule-config-dialog'
import { fireEvent, render, screen, waitFor } from '../../helpers/ui/render'
import { LanguageModeChangedEvent } from '../../../src/lib/i18n'
import {
  LanguageModeStorageKey,
  LegacyAppearanceStorageKey,
} from '../../../src/lib/language-preference'

let restoreIpcSend: (() => void) | null = null
let restoreDialogShow: (() => void) | null = null
let restoreWindowResizeObserver: (() => void) | null = null

class DialogResizeObserver implements ResizeObserver {
  public constructor(private readonly callback: ResizeObserverCallback) {}

  public observe(target: Element) {
    const width = 560
    const height = 400
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
  localStorage.removeItem(LanguageModeStorageKey)
  localStorage.removeItem(LegacyAppearanceStorageKey)
})

const repository = new Repository('C:/fixtures/superproject', 1, null, false)

const baseSubmodule: IManagedSubmodule = {
  name: 'vendor-lib',
  path: 'vendor/lib',
  url: 'https://github.com/example/lib.git',
  branch: 'main',
  update: null,
  ignore: null,
  shallow: null,
  fetchRecurseSubmodules: null,
  sha: 'abc1234def5678000000000000000000deadbeef',
  describe: null,
  status: 'up-to-date',
}

interface IConfigKeyCall {
  readonly name: string
  readonly key: SubmoduleConfigKey
  readonly value: string | null
}

interface IRecordedCalls {
  readonly setSubmoduleUrl: Array<{ path: string; url: string }>
  readonly setSubmoduleBranch: Array<{ path: string; branch: string | null }>
  readonly setSubmoduleConfigKey: Array<IConfigKeyCall>
  readonly syncSubmodules: Array<ReadonlyArray<string> | undefined>
  readonly initSubmodule: Array<string>
  readonly deinitSubmodule: Array<{ path: string; force: boolean }>
}

interface IDispatcherOverrides {
  readonly setSubmoduleUrl?: () => Promise<void>
  readonly setSubmoduleBranch?: () => Promise<void>
  readonly setSubmoduleConfigKey?: () => Promise<void>
  readonly syncSubmodules?: () => Promise<void>
  readonly initSubmodule?: () => Promise<void>
  readonly deinitSubmodule?: () => Promise<void>
}

function createDispatcher(overrides: IDispatcherOverrides = {}) {
  const calls: IRecordedCalls = {
    setSubmoduleUrl: [],
    setSubmoduleBranch: [],
    setSubmoduleConfigKey: [],
    syncSubmodules: [],
    initSubmodule: [],
    deinitSubmodule: [],
  }

  const dispatcher = {
    setSubmoduleUrl: async (
      _repository: Repository,
      path: string,
      url: string
    ) => {
      calls.setSubmoduleUrl.push({ path, url })
      await overrides.setSubmoduleUrl?.()
    },
    setSubmoduleBranch: async (
      _repository: Repository,
      path: string,
      branch: string | null
    ) => {
      calls.setSubmoduleBranch.push({ path, branch })
      await overrides.setSubmoduleBranch?.()
    },
    setSubmoduleConfigKey: async (
      _repository: Repository,
      name: string,
      key: SubmoduleConfigKey,
      value: string | null
    ) => {
      calls.setSubmoduleConfigKey.push({ name, key, value })
      await overrides.setSubmoduleConfigKey?.()
    },
    syncSubmodules: async (
      _repository: Repository,
      paths?: ReadonlyArray<string>
    ) => {
      calls.syncSubmodules.push(paths)
      await overrides.syncSubmodules?.()
    },
    initSubmodule: async (_repository: Repository, path: string) => {
      calls.initSubmodule.push(path)
      await overrides.initSubmodule?.()
    },
    deinitSubmodule: async (
      _repository: Repository,
      path: string,
      force: boolean
    ) => {
      calls.deinitSubmodule.push({ path, force })
      await overrides.deinitSubmodule?.()
    },
  } as unknown as Dispatcher

  return { dispatcher, calls }
}

function renderDialog(
  dispatcher: Dispatcher,
  submodule: IManagedSubmodule = baseSubmodule,
  onDismissed: () => void = () => undefined
) {
  return render(
    <SubmoduleConfigDialog
      repository={repository}
      submodule={submodule}
      dispatcher={dispatcher}
      onDismissed={onDismissed}
    />
  )
}

describe('SubmoduleConfigDialog', () => {
  beforeEach(() => {
    // The file-level hook configures the shared DOM once for this suite. Reset
    // the persisted preference for every nested test so the localization case
    // cannot leak Cantonese into the English behavior cases that follow it.
    localStorage.removeItem(LanguageModeStorageKey)
    localStorage.removeItem(LegacyAppearanceStorageKey)
  })

  it('reacts across Cantonese and semantic bilingual copy with concise accessible controls', async () => {
    localStorage.setItem(
      LegacyAppearanceStorageKey,
      JSON.stringify({ version: 1, languageMode: 'cantonese' })
    )
    const { dispatcher } = createDispatcher()
    renderDialog(dispatcher)

    assert.ok(screen.getByRole('dialog', { name: '設定 vendor-lib' }))
    assert.ok(screen.getByLabelText('遠端 URL'))
    assert.ok(screen.getByRole('button', { name: '儲存變更' }))

    document.dispatchEvent(
      new CustomEvent(LanguageModeChangedEvent, { detail: 'bilingual' })
    )
    await waitFor(() => {
      assert.ok(screen.getByRole('button', { name: 'Save changes' }))
      assert.equal(
        screen.queryByRole('button', { name: 'Save changes · 儲存變更' }),
        null
      )
      const title = document.querySelector('#submodule-config-title')
      assert.equal(
        title?.querySelector('[lang="en"]')?.textContent,
        'Configure vendor-lib'
      )
      assert.equal(
        title?.querySelector('[lang="zh-HK"]')?.textContent,
        '設定 vendor-lib'
      )
    })
  })

  it('seeds every field from the reconciled submodule', () => {
    const { dispatcher } = createDispatcher()
    renderDialog(dispatcher, {
      ...baseSubmodule,
      update: 'rebase',
      ignore: 'dirty',
      fetchRecurseSubmodules: 'on-demand',
      shallow: true,
    })

    assert.ok(screen.getByText(/configure vendor-lib/i))
    assert.equal(
      (screen.getByLabelText('Remote URL') as HTMLInputElement).value,
      'https://github.com/example/lib.git'
    )
    assert.equal(
      (screen.getByLabelText('Branch') as HTMLInputElement).value,
      'main'
    )
    assert.equal(
      (screen.getByLabelText('Update strategy') as HTMLSelectElement).value,
      'rebase'
    )
    assert.equal(
      (screen.getByLabelText('Ignore dirty state') as HTMLSelectElement).value,
      'dirty'
    )
    assert.equal(
      (screen.getByLabelText('Fetch recurse submodules') as HTMLSelectElement)
        .value,
      'on-demand'
    )
    assert.equal(
      (screen.getByLabelText('Shallow clone') as HTMLInputElement).checked,
      true
    )
  })

  it('seeds unset keys as inherit-default and shallow as mixed', () => {
    const { dispatcher } = createDispatcher()
    renderDialog(dispatcher)

    assert.equal(
      (screen.getByLabelText('Update strategy') as HTMLSelectElement).value,
      'inherit-default'
    )
    assert.equal(
      (screen.getByLabelText('Ignore dirty state') as HTMLSelectElement).value,
      'inherit-default'
    )
    assert.equal(
      (screen.getByLabelText('Fetch recurse submodules') as HTMLSelectElement)
        .value,
      'inherit-default'
    )
    assert.equal(
      (screen.getByLabelText('Shallow clone') as HTMLInputElement)
        .indeterminate,
      true
    )
  })

  it('saves only the changed fields through the matching dispatcher methods', async () => {
    const { dispatcher, calls } = createDispatcher()
    let dismissed = 0
    renderDialog(dispatcher, baseSubmodule, () => {
      dismissed++
    })

    fireEvent.change(screen.getByLabelText('Branch'), {
      target: { value: 'develop' },
    })
    fireEvent.change(screen.getByLabelText('Update strategy'), {
      target: { value: 'rebase' },
    })
    fireEvent.click(screen.getByRole('button', { name: /save/i }))

    await waitFor(() => assert.equal(dismissed, 1))
    assert.deepEqual(calls.setSubmoduleUrl, [])
    assert.deepEqual(calls.setSubmoduleBranch, [
      { path: 'vendor/lib', branch: 'develop' },
    ])
    assert.deepEqual(calls.setSubmoduleConfigKey, [
      { name: 'vendor-lib', key: 'update', value: 'rebase' },
    ])
    assert.deepEqual(calls.syncSubmodules, [])
    assert.deepEqual(calls.deinitSubmodule, [])
  })

  it('clears configured keys through the inherit-default sentinel', async () => {
    const { dispatcher, calls } = createDispatcher()
    let dismissed = 0
    renderDialog(
      dispatcher,
      { ...baseSubmodule, update: 'rebase', shallow: true },
      () => {
        dismissed++
      }
    )

    fireEvent.change(screen.getByLabelText('Update strategy'), {
      target: { value: 'inherit-default' },
    })
    fireEvent.click(screen.getByRole('button', { name: /use default/i }))
    fireEvent.click(screen.getByRole('button', { name: /save/i }))

    await waitFor(() => assert.equal(dismissed, 1))
    assert.deepEqual(calls.setSubmoduleConfigKey, [
      { name: 'vendor-lib', key: 'update', value: null },
      { name: 'vendor-lib', key: 'shallow', value: null },
    ])
    assert.deepEqual(calls.setSubmoduleUrl, [])
    assert.deepEqual(calls.setSubmoduleBranch, [])
  })

  it('dismisses without any dispatcher call when nothing changed', async () => {
    const { dispatcher, calls } = createDispatcher()
    let dismissed = 0
    renderDialog(dispatcher, baseSubmodule, () => {
      dismissed++
    })

    fireEvent.click(screen.getByRole('button', { name: /save/i }))

    await waitFor(() => assert.equal(dismissed, 1))
    assert.deepEqual(calls.setSubmoduleUrl, [])
    assert.deepEqual(calls.setSubmoduleBranch, [])
    assert.deepEqual(calls.setSubmoduleConfigKey, [])
  })

  it('surfaces a per-step error inline and stays open', async () => {
    const { dispatcher, calls } = createDispatcher({
      setSubmoduleBranch: () => Promise.reject(new Error('boom')),
    })
    let dismissed = 0
    renderDialog(dispatcher, baseSubmodule, () => {
      dismissed++
    })

    fireEvent.change(screen.getByLabelText('Branch'), {
      target: { value: 'develop' },
    })
    fireEvent.click(screen.getByRole('button', { name: /save/i }))

    assert.ok(
      await screen.findByText(
        /failed setting the branch for vendor\/lib: boom/i
      )
    )
    assert.equal(dismissed, 0)
    assert.equal(calls.setSubmoduleBranch.length, 1)
  })

  it('syncs the submodule in place without dismissing', async () => {
    const { dispatcher, calls } = createDispatcher()
    let dismissed = 0
    renderDialog(dispatcher, baseSubmodule, () => {
      dismissed++
    })

    fireEvent.click(screen.getByRole('button', { name: /^sync$/i }))

    await waitFor(() =>
      assert.deepEqual(calls.syncSubmodules, [['vendor/lib']])
    )
    assert.equal(dismissed, 0)
  })

  it('offers Init only for uninitialized submodules', async () => {
    const { dispatcher, calls } = createDispatcher()
    const initialized = renderDialog(dispatcher)
    assert.equal(screen.queryByRole('button', { name: /^init$/i }), null)
    initialized.unmount()

    renderDialog(dispatcher, {
      ...baseSubmodule,
      sha: null,
      status: 'uninitialized',
    })
    fireEvent.click(screen.getByRole('button', { name: /^init$/i }))

    await waitFor(() => assert.deepEqual(calls.initSubmodule, ['vendor/lib']))
  })

  it('asks for confirmation before forcing a deinit', async () => {
    const { dispatcher, calls } = createDispatcher()
    let dismissed = 0
    renderDialog(dispatcher, baseSubmodule, () => {
      dismissed++
    })

    fireEvent.click(screen.getByRole('button', { name: /deinit…/i }))

    assert.ok(screen.getByText(/are you sure you want to deinit/i))
    assert.deepEqual(calls.deinitSubmodule, [])

    fireEvent.click(screen.getByRole('button', { name: /^deinit$/i }))

    await waitFor(() =>
      assert.deepEqual(calls.deinitSubmodule, [
        { path: 'vendor/lib', force: true },
      ])
    )
    assert.equal(dismissed, 1)
  })

  it('returns to the form when the deinit confirmation is cancelled', () => {
    const { dispatcher, calls } = createDispatcher()
    let dismissed = 0
    renderDialog(dispatcher, baseSubmodule, () => {
      dismissed++
    })

    fireEvent.click(screen.getByRole('button', { name: /deinit…/i }))
    fireEvent.click(screen.getByRole('button', { name: /cancel/i }))

    assert.ok(screen.getByLabelText('Remote URL'))
    assert.deepEqual(calls.deinitSubmodule, [])
    assert.equal(dismissed, 0)
  })
})
