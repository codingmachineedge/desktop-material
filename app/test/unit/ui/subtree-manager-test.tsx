import assert from 'node:assert'
import { afterEach, beforeEach, describe, it } from 'node:test'
import * as React from 'react'

import { IManagedSubtree } from '../../../src/lib/git'
import { IRemote } from '../../../src/models/remote'
import { Popup, PopupType } from '../../../src/models/popup'
import { Repository } from '../../../src/models/repository'
import { Dispatcher } from '../../../src/ui/dispatcher'
import {
  SubtreeManager,
  SubtreeManagerDialog,
} from '../../../src/ui/subtrees/subtree-manager-dialog'
import { AddSubtreeDialog } from '../../../src/ui/subtrees/add-subtree-dialog'
import {
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from '../../helpers/ui/render'

let restoreIpcSend: (() => void) | null = null
let restoreDialogShow: (() => void) | null = null
let restoreWindowResizeObserver: (() => void) | null = null

interface IDeferred<T> {
  readonly promise: Promise<T>
  readonly resolve: (value: T) => void
  readonly reject: (reason: Error) => void
}

function deferred<T>(): IDeferred<T> {
  let resolve!: (value: T) => void
  let reject!: (reason: Error) => void
  const promise = new Promise<T>((onResolve, onReject) => {
    resolve = onResolve
    reject = onReject
  })
  return { promise, resolve, reject }
}

class DialogResizeObserver implements ResizeObserver {
  public constructor(private readonly callback: ResizeObserverCallback) {}

  public observe(target: Element) {
    const width = 640
    const height = 420
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

const subtrees: ReadonlyArray<IManagedSubtree> = [
  {
    prefix: 'tools/scripts',
    lastMergedSplitSha: null,
    lastMergeSha: '1111222233334444555566667777888899990000',
  },
  {
    prefix: 'vendor/lib',
    lastMergedSplitSha: 'abcd1234abcd1234abcd1234abcd1234abcd1234',
    lastMergeSha: 'feedc0defeedc0defeedc0defeedc0defeedc0de',
  },
]

const remotes: ReadonlyArray<IRemote> = [
  { name: 'origin', url: 'https://github.com/example/parent.git' },
  { name: 'upstream', url: 'https://github.com/example/lib.git' },
]

interface ISubtreeCall {
  readonly prefix: string
  readonly source: string
  readonly ref: string
  readonly squash: boolean | undefined
  readonly accountKey: string | undefined
}

interface IRecordedCalls {
  readonly pullSubtree: Array<ISubtreeCall>
  readonly pushSubtree: Array<Omit<ISubtreeCall, 'squash'>>
  readonly splitSubtree: Array<{ prefix: string; branch: string | undefined }>
  readonly showPopup: Array<Popup>
}

function createDispatcher(
  available = true,
  splitResult = 'deadbeefcafedeadbeefcafedeadbeefcafe0000'
) {
  const calls: IRecordedCalls = {
    pullSubtree: [],
    pushSubtree: [],
    splitSubtree: [],
    showPopup: [],
  }

  const dispatcher = {
    isSubtreeAvailable: async () => available,
    getSubtrees: async (_repository: Repository) => subtrees,
    pullSubtree: async (
      _repository: Repository,
      prefix: string,
      source: string,
      ref: string,
      options?: {
        squash?: boolean
        accountKey?: string
        progressCallback?: (line: string, percent: number) => void
      }
    ) => {
      calls.pullSubtree.push({
        prefix,
        source,
        ref,
        squash: options?.squash,
        accountKey: options?.accountKey,
      })
    },
    pushSubtree: async (
      _repository: Repository,
      prefix: string,
      source: string,
      ref: string,
      options?: { accountKey?: string }
    ) => {
      calls.pushSubtree.push({
        prefix,
        source,
        ref,
        accountKey: options?.accountKey,
      })
    },
    splitSubtree: async (
      _repository: Repository,
      prefix: string,
      options?: { branch?: string }
    ) => {
      calls.splitSubtree.push({ prefix, branch: options?.branch })
      return splitResult
    },
    showPopup: (popup: Popup) => {
      calls.showPopup.push(popup)
    },
  } as unknown as Dispatcher

  return { dispatcher, calls }
}

function renderManager(dispatcher: Dispatcher) {
  return render(
    <SubtreeManagerDialog
      repository={repository}
      dispatcher={dispatcher}
      accounts={[]}
      onDismissed={() => undefined}
      listRemotes={async () => remotes}
    />
  )
}

async function findRow(prefix: string): Promise<HTMLElement> {
  const label = await screen.findByText(prefix)
  const row = label.closest('li')
  assert.ok(row !== null, `expected a list row for ${prefix}`)
  return row
}

describe('SubtreeManagerDialog', () => {
  it('reuses the full management surface without nesting a dialog', async () => {
    const { dispatcher } = createDispatcher()
    const view = render(
      <section id="repository-settings">
        <SubtreeManager
          repository={repository}
          dispatcher={dispatcher}
          accounts={[]}
          listRemotes={async () => remotes}
        />
      </section>
    )

    const row = await findRow('vendor/lib')
    assert.equal(view.container.querySelector('dialog'), null)
    assert.ok(within(row).getByRole('button', { name: /pull…/i }))
    assert.ok(within(row).getByRole('button', { name: /push…/i }))
    assert.ok(within(row).getByRole('button', { name: /split…/i }))
    assert.ok(screen.getByRole('button', { name: /add subtree…/i }))
  })

  it('lists the discovered subtrees with their recorded SHAs', async () => {
    const { dispatcher } = createDispatcher()
    renderManager(dispatcher)

    const row = await findRow('vendor/lib')
    assert.ok(screen.getByText('tools/scripts'))
    assert.ok(within(row).getByText(/upstream split abcd1234/i))
    assert.ok(within(row).getByText(/last merge feedc0de/i))

    // A subtree that never recorded a split shows a placeholder.
    const scripts = await findRow('tools/scripts')
    assert.ok(within(scripts).getByText(/upstream split —/i))
  })

  it('filters the list by prefix case-insensitively', async () => {
    const { dispatcher } = createDispatcher()
    renderManager(dispatcher)
    await findRow('vendor/lib')

    fireEvent.change(screen.getByLabelText('Search subtrees'), {
      target: { value: 'VENDOR' },
    })

    assert.ok(screen.getByText('vendor/lib'))
    assert.equal(screen.queryByText('tools/scripts'), null)

    fireEvent.change(screen.getByLabelText('Search subtrees'), {
      target: { value: 'no-such-prefix' },
    })
    assert.ok(screen.getByText(/no subtrees match the current search/i))
  })

  it('pulls a subtree from the chosen remote and ref', async () => {
    const { dispatcher, calls } = createDispatcher()
    renderManager(dispatcher)

    const row = await findRow('vendor/lib')
    fireEvent.click(within(row).getByRole('button', { name: /pull…/i }))

    fireEvent.change(screen.getByLabelText('Source'), {
      target: { value: 'upstream' },
    })
    fireEvent.change(screen.getByLabelText('Ref'), {
      target: { value: 'main' },
    })
    fireEvent.click(
      screen.getByLabelText('Squash the pulled history into one commit')
    )
    fireEvent.click(screen.getByRole('button', { name: /^pull subtree$/i }))

    await waitFor(() =>
      assert.deepEqual(calls.pullSubtree, [
        {
          prefix: 'vendor/lib',
          source: 'https://github.com/example/lib.git',
          ref: 'main',
          squash: true,
          accountKey: undefined,
        },
      ])
    )
    assert.ok(await screen.findByText(/pulled main into vendor\/lib/i))
  })

  it('pushes a subtree through a custom source URL', async () => {
    const { dispatcher, calls } = createDispatcher()
    renderManager(dispatcher)

    const row = await findRow('tools/scripts')
    fireEvent.click(within(row).getByRole('button', { name: /push…/i }))

    fireEvent.change(screen.getByLabelText('Source'), {
      target: { value: '' },
    })
    fireEvent.change(screen.getByLabelText('Source URL'), {
      target: { value: 'https://example.invalid/scripts.git' },
    })
    fireEvent.change(screen.getByLabelText('Ref'), {
      target: { value: 'scripts-main' },
    })
    fireEvent.click(screen.getByRole('button', { name: /^push subtree$/i }))

    await waitFor(() =>
      assert.deepEqual(calls.pushSubtree, [
        {
          prefix: 'tools/scripts',
          source: 'https://example.invalid/scripts.git',
          ref: 'scripts-main',
          accountKey: undefined,
        },
      ])
    )
  })

  it('splits a subtree into the prompted branch and reports the head', async () => {
    const { dispatcher, calls } = createDispatcher()
    renderManager(dispatcher)

    const row = await findRow('vendor/lib')
    fireEvent.click(within(row).getByRole('button', { name: /split…/i }))

    fireEvent.change(screen.getByLabelText('Branch name'), {
      target: { value: 'lib-split' },
    })
    fireEvent.click(screen.getByRole('button', { name: /^split subtree$/i }))

    await waitFor(() =>
      assert.deepEqual(calls.splitSubtree, [
        { prefix: 'vendor/lib', branch: 'lib-split' },
      ])
    )
    assert.ok(
      await screen.findByText(
        /split vendor\/lib into branch lib-split at deadbeef/i
      )
    )
  })

  it('opens the add-subtree popup from the header', async () => {
    const { dispatcher, calls } = createDispatcher()
    renderManager(dispatcher)
    await findRow('vendor/lib')

    fireEvent.click(screen.getByRole('button', { name: /add subtree…/i }))

    assert.equal(calls.showPopup.length, 1)
    assert.equal(calls.showPopup[0].type, PopupType.AddSubtree)
  })

  it('fences every mutation and the standalone host while one operation runs', async () => {
    const pull = deferred<void>()
    const operationStates = new Array<boolean>()
    let pullCalls = 0
    let splitCalls = 0
    let dismissed = 0
    const dispatcher = {
      isSubtreeAvailable: async () => true,
      getSubtrees: async () => subtrees,
      pullSubtree: async () => {
        pullCalls++
        return pull.promise
      },
      splitSubtree: async () => {
        splitCalls++
        return 'unused'
      },
      showPopup: () => undefined,
    } as unknown as Dispatcher

    render(
      <SubtreeManagerDialog
        repository={repository}
        dispatcher={dispatcher}
        accounts={[]}
        onDismissed={() => {
          dismissed++
        }}
        listRemotes={async () => remotes}
        onOperationStateChanged={inProgress => operationStates.push(inProgress)}
      />
    )

    const vendor = await findRow('vendor/lib')
    const scripts = await findRow('tools/scripts')
    fireEvent.click(within(vendor).getByRole('button', { name: /pull/i }))
    fireEvent.change(screen.getByLabelText('Ref'), {
      target: { value: 'main' },
    })
    fireEvent.click(screen.getByRole('button', { name: /^pull subtree$/i }))

    await waitFor(() => assert.equal(pullCalls, 1))
    assert.deepEqual(operationStates, [true])

    for (const name of [/pull/i, /push/i, /split/i]) {
      assert.equal(
        within(scripts)
          .getByRole('button', { name })
          .getAttribute('aria-disabled'),
        'true'
      )
    }
    assert.equal(
      screen
        .getByRole('button', { name: /add subtree/i })
        .getAttribute('aria-disabled'),
      'true'
    )
    assert.equal(
      screen
        .getByRole('button', { name: /^pull subtree$/i })
        .getAttribute('aria-disabled'),
      'true'
    )
    assert.equal(
      screen
        .getByRole('button', { name: /^cancel$/i })
        .getAttribute('aria-disabled'),
      'true'
    )

    fireEvent.click(within(scripts).getByRole('button', { name: /split/i }))
    fireEvent.click(screen.getByRole('button', { name: /^close$/i }))
    assert.equal(splitCalls, 0)
    assert.equal(dismissed, 0)

    pull.resolve()
    await waitFor(() => assert.deepEqual(operationStates, [true, false]))
    assert.ok(await screen.findByText(/pulled main into vendor\/lib/i))
  })

  it('announces streamed progress politely and failures assertively', async () => {
    const pull = deferred<void>()
    const dispatcher = {
      isSubtreeAvailable: async () => true,
      getSubtrees: async () => subtrees,
      pullSubtree: async (
        _repository: Repository,
        _prefix: string,
        _source: string,
        _ref: string,
        options?: { progressCallback?: (line: string) => void }
      ) => {
        options?.progressCallback?.('Receiving upstream objects...')
        return pull.promise
      },
      showPopup: () => undefined,
    } as unknown as Dispatcher

    renderManager(dispatcher)
    const vendor = await findRow('vendor/lib')
    fireEvent.click(within(vendor).getByRole('button', { name: /pull/i }))
    fireEvent.change(screen.getByLabelText('Ref'), {
      target: { value: 'main' },
    })
    fireEvent.click(screen.getByRole('button', { name: /^pull subtree$/i }))

    const progress = await screen.findByText('Receiving upstream objects...')
    assert.equal(progress.getAttribute('role'), 'status')
    assert.equal(progress.getAttribute('aria-live'), 'polite')

    pull.reject(new Error('upstream disconnected'))
    const error = await screen.findByRole('alert')
    assert.match(error.textContent ?? '', /upstream disconnected/i)
    assert.equal(error.getAttribute('aria-live'), 'assertive')
  })

  it('ignores stale subtree loads when a newer refresh finishes first', async () => {
    const initial = deferred<ReadonlyArray<IManagedSubtree>>()
    const refresh = deferred<ReadonlyArray<IManagedSubtree>>()
    let loadCount = 0
    const popups = new Array<Popup>()
    const dispatcher = {
      isSubtreeAvailable: async () => true,
      getSubtrees: async () => {
        loadCount++
        return loadCount === 1 ? initial.promise : refresh.promise
      },
      showPopup: (nextPopup: Popup) => {
        popups.push(nextPopup)
      },
    } as unknown as Dispatcher

    render(
      <SubtreeManager
        repository={repository}
        dispatcher={dispatcher}
        accounts={[]}
        listRemotes={async () => remotes}
      />
    )

    await waitFor(() => assert.equal(loadCount, 1))
    fireEvent.click(screen.getByRole('button', { name: /add subtree/i }))
    assert.equal(popups.length, 1)
    const popup = popups[0]
    assert.ok(popup.type === PopupType.AddSubtree)
    const refreshLoad = popup.onAdded()
    await waitFor(() => assert.equal(loadCount, 2))

    refresh.resolve([subtrees[1]])
    await refreshLoad
    assert.ok(await screen.findByText('vendor/lib'))
    initial.resolve([subtrees[0]])

    await waitFor(() => {
      assert.ok(screen.getByText('vendor/lib'))
      assert.equal(screen.queryByText('tools/scripts'), null)
    })
  })

  it('does not reload or update the unmounted surface when an operation settles', async () => {
    const pull = deferred<void>()
    const operationStates = new Array<boolean>()
    let loadCount = 0
    const dispatcher = {
      isSubtreeAvailable: async () => true,
      getSubtrees: async () => {
        loadCount++
        return subtrees
      },
      pullSubtree: async () => pull.promise,
      showPopup: () => undefined,
    } as unknown as Dispatcher

    const view = render(
      <SubtreeManager
        repository={repository}
        dispatcher={dispatcher}
        accounts={[]}
        listRemotes={async () => remotes}
        onOperationStateChanged={inProgress => operationStates.push(inProgress)}
      />
    )
    const vendor = await findRow('vendor/lib')
    fireEvent.click(within(vendor).getByRole('button', { name: /pull/i }))
    fireEvent.change(screen.getByLabelText('Ref'), {
      target: { value: 'main' },
    })
    fireEvent.click(screen.getByRole('button', { name: /^pull subtree$/i }))
    await waitFor(() => assert.deepEqual(operationStates, [true]))

    view.unmount()
    pull.resolve()
    await waitFor(() => assert.deepEqual(operationStates, [true, false]))
    assert.equal(loadCount, 1)
  })

  it('disables every action when git subtree is unavailable', async () => {
    const { dispatcher } = createDispatcher(false)
    renderManager(dispatcher)

    const row = await findRow('vendor/lib')
    assert.ok(await screen.findByText(/does not ship the `git subtree`/i))
    for (const name of [/pull…/i, /push…/i, /split…/i]) {
      assert.equal(
        within(row).getByRole('button', { name }).getAttribute('aria-disabled'),
        'true'
      )
    }
  })

  it('guides toward adding a first subtree when none are recorded', async () => {
    const calls: Array<Popup> = []
    const dispatcher = {
      isSubtreeAvailable: async () => true,
      getSubtrees: async () => [],
      showPopup: (popup: Popup) => {
        calls.push(popup)
      },
    } as unknown as Dispatcher

    render(
      <SubtreeManagerDialog
        repository={repository}
        dispatcher={dispatcher}
        accounts={[]}
        onDismissed={() => undefined}
        listRemotes={async () => remotes}
      />
    )

    const message = await screen.findByText(
      /no subtrees yet — add one to vendor a folder/i
    )
    const emptyState = message.closest('.subtrees-empty-state')
    assert.ok(emptyState !== null, 'expected the empty-state container')

    fireEvent.click(
      within(emptyState as HTMLElement).getByRole('button', {
        name: /add subtree…/i,
      })
    )
    assert.equal(calls.length, 1)
    assert.equal(calls[0].type, PopupType.AddSubtree)
  })

  it('hides the empty-state add affordance when git subtree is unavailable', async () => {
    const dispatcher = {
      isSubtreeAvailable: async () => false,
      getSubtrees: async () => [],
      showPopup: () => undefined,
    } as unknown as Dispatcher

    render(
      <SubtreeManagerDialog
        repository={repository}
        dispatcher={dispatcher}
        accounts={[]}
        onDismissed={() => undefined}
        listRemotes={async () => remotes}
      />
    )

    // The gated explanation surfaces once the availability probe resolves.
    await screen.findByText(/does not ship the `git subtree`/i)

    const message = screen.getByText(
      /no subtrees yet — add one to vendor a folder/i
    )
    const emptyState = message.closest('.subtrees-empty-state')
    assert.ok(emptyState !== null, 'expected the empty-state container')
    assert.equal(
      within(emptyState as HTMLElement).queryByRole('button', {
        name: /add subtree…/i,
      }),
      null
    )
  })
})

interface IAddCall {
  readonly prefix: string
  readonly source: string
  readonly ref: string
  readonly squash: boolean | undefined
  readonly accountKey: string | undefined
}

describe('AddSubtreeDialog', () => {
  it('submits the reviewed URL, prefix, ref, and squash choice', async () => {
    const calls = new Array<IAddCall>()
    let added = 0
    let dismissed = 0
    const dispatcher = {
      addSubtree: async (
        _repository: Repository,
        prefix: string,
        source: string,
        ref: string,
        options?: { squash?: boolean; accountKey?: string }
      ) => {
        calls.push({
          prefix,
          source,
          ref,
          squash: options?.squash,
          accountKey: options?.accountKey,
        })
      },
    } as unknown as Dispatcher

    render(
      <AddSubtreeDialog
        repository={repository}
        dispatcher={dispatcher}
        accounts={[]}
        apiRepositories={new Map()}
        onRefreshRepositories={() => undefined}
        onAdded={() => {
          added++
        }}
        onDismissed={() => {
          dismissed++
        }}
      />
    )

    fireEvent.click(screen.getByText('URL'))
    fireEvent.change(screen.getByLabelText('Repository URL'), {
      target: { value: 'https://github.com/example/shared-library.git' },
    })
    fireEvent.change(screen.getByLabelText('Prefix inside repository'), {
      target: { value: 'vendor/shared-library' },
    })
    fireEvent.change(screen.getByLabelText('Ref'), {
      target: { value: 'stable' },
    })
    fireEvent.click(
      screen.getByLabelText('Squash the imported history into one commit')
    )
    fireEvent.click(screen.getByRole('button', { name: /^add subtree$/i }))

    await waitFor(() =>
      assert.deepEqual(calls, [
        {
          prefix: 'vendor/shared-library',
          source: 'https://github.com/example/shared-library.git',
          ref: 'stable',
          squash: false,
          accountKey: undefined,
        },
      ])
    )
    assert.equal(added, 1)
    assert.equal(dismissed, 1)
  })

  it('keeps the submit disabled while the prefix is invalid', () => {
    const dispatcher = {} as Dispatcher
    render(
      <AddSubtreeDialog
        repository={repository}
        dispatcher={dispatcher}
        accounts={[]}
        apiRepositories={new Map()}
        onRefreshRepositories={() => undefined}
        onAdded={() => undefined}
        onDismissed={() => undefined}
      />
    )

    fireEvent.click(screen.getByText('URL'))
    fireEvent.change(screen.getByLabelText('Repository URL'), {
      target: { value: 'https://github.com/example/shared-library.git' },
    })
    fireEvent.change(screen.getByLabelText('Prefix inside repository'), {
      target: { value: '../escape' },
    })
    fireEvent.change(screen.getByLabelText('Ref'), {
      target: { value: 'main' },
    })

    assert.equal(
      screen
        .getByRole('button', { name: /^add subtree$/i })
        .getAttribute('aria-disabled'),
      'true'
    )
    assert.ok(screen.getByText(/may not contain empty, "." or ".."/i))
  })
})
