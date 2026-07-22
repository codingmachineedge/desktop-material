import assert from 'node:assert'
import { afterEach, beforeEach, describe, it } from 'node:test'
import * as React from 'react'

import { IPullPreview } from '../../src/lib/git/pull-preview'
import { createPullStrategyPlan } from '../../src/lib/git/pull-strategy'
import {
  IPreparedPullPreview,
  PullPreviewError,
  PullPreviewWorktreeState,
} from '../../src/lib/pull-preview'
import { LanguageModeStorageKey } from '../../src/lib/language-preference'
import { Repository } from '../../src/models/repository'
import { AppFileStatusKind, FileChange } from '../../src/models/status'
import { Dispatcher } from '../../src/ui/dispatcher'
import { PullPreviewDialog } from '../../src/ui/pull-preview'
import { fireEvent, render, screen, waitFor } from '../helpers/ui/render'
import {
  advanceTimersBy,
  enableTestTimers,
  resetTestTimers,
} from '../helpers/ui/timers'

const repository = new Repository('C:/pull-preview', 1, null, false)

let restoreIpcSend: (() => void) | null = null
let restoreDialogShow: (() => void) | null = null

beforeEach(async () => {
  localStorage.removeItem(LanguageModeStorageKey)

  const electron = await import('electron')
  const previousSend = electron.ipcRenderer.send
  electron.ipcRenderer.send = () => {}
  restoreIpcSend = () => {
    electron.ipcRenderer.send = previousSend
    restoreIpcSend = null
  }

  const prototype = window.HTMLDialogElement.prototype
  const previousShow = prototype.show
  const previousShowModal = prototype.showModal
  prototype.show = function () {
    this.setAttribute('open', '')
  }
  prototype.showModal = function () {
    this.setAttribute('open', '')
  }
  restoreDialogShow = () => {
    prototype.show = previousShow
    prototype.showModal = previousShowModal
    restoreDialogShow = null
  }
})

afterEach(() => {
  restoreIpcSend?.()
  restoreDialogShow?.()
  localStorage.removeItem(LanguageModeStorageKey)
})

function createPreview(overrides: Partial<IPullPreview> = {}): IPullPreview {
  return {
    kind: 'ready',
    currentBranchRef: 'refs/heads/main',
    currentBranchOid: '1'.repeat(40),
    upstreamRef: 'refs/remotes/origin/main',
    upstreamOid: '2'.repeat(40),
    mergeBaseOid: '1'.repeat(40),
    ahead: 0,
    behind: 2,
    incomingCommits: [
      { sha: '2'.repeat(40), summary: 'Finish reviewed pull' },
      { sha: '3'.repeat(40), summary: 'Prepare reviewed pull' },
    ],
    incomingCommitsTruncated: false,
    changedFiles: [
      new FileChange('src/pull-preview.ts', {
        kind: AppFileStatusKind.Modified,
      }),
      new FileChange('src/new-name.ts', {
        kind: AppFileStatusKind.Renamed,
        oldPath: 'src/old-name.ts',
        renameIncludesModifications: false,
      }),
    ],
    changedFileCount: 2,
    changedFilesTruncated: false,
    ...overrides,
  }
}

function createPrepared(
  result: IPullPreview = createPreview(),
  worktreeState: PullPreviewWorktreeState = 'clean'
): IPreparedPullPreview {
  return {
    result,
    integrationPlan: createPullStrategyPlan(
      { rebase: 'false', ff: 'ff' },
      result.ahead,
      result.behind
    ),
    worktreeState,
  }
}

function createDispatcher(
  prepare: (repository: Repository) => Promise<IPreparedPullPreview>,
  pull: (
    repository: Repository,
    prepared: IPreparedPullPreview
  ) => Promise<void> = async () => undefined,
  postError: (error: Error) => Promise<void> = async () => undefined
): Dispatcher {
  return {
    preparePullPreview: prepare,
    pullReviewed: pull,
    postError,
  } as unknown as Dispatcher
}

function renderDialog(
  dispatcher: Dispatcher,
  onDismissed: () => void = () => undefined
) {
  return render(
    React.createElement(PullPreviewDialog, {
      dispatcher,
      repository,
      onDismissed,
    })
  )
}

interface IDeferred<T> {
  readonly promise: Promise<T>
  readonly resolve: (value: T) => void
  readonly reject: (error: unknown) => void
}

function deferred<T>(): IDeferred<T> {
  let resolve!: (value: T) => void
  let reject!: (error: unknown) => void
  const promise = new Promise<T>((onResolve, onReject) => {
    resolve = onResolve
    reject = onReject
  })
  return { promise, resolve, reject }
}

describe('PullPreviewDialog', () => {
  it('renders the fetched review and confirms the exact prepared snapshot', async () => {
    const preview = createPreview()
    const prepared = createPrepared(preview)
    const pulls = new Array<{
      readonly repository: Repository
      readonly prepared: IPreparedPullPreview
    }>()
    let dismissed = 0

    const view = renderDialog(
      createDispatcher(
        async candidate => {
          assert.strictEqual(candidate, repository)
          return prepared
        },
        async (candidate, acceptedPrepared) => {
          pulls.push({ repository: candidate, prepared: acceptedPrepared })
        }
      ),
      () => dismissed++
    )

    assert.ok(await screen.findByText('Finish reviewed pull'))
    assert.ok(screen.getByText('Prepare reviewed pull'))
    assert.ok(screen.getByText('src/pull-preview.ts'))
    assert.ok(screen.getByText('src/old-name.ts → src/new-name.ts'))
    assert.ok(screen.getByText('0 ahead'))
    assert.ok(screen.getByText('2 behind'))
    assert.ok(screen.getByText('origin/main'))

    const oidElements = Array.from(
      view.container.querySelectorAll('code[aria-hidden="true"]')
    )
    assert.deepEqual(
      oidElements.map(element => ({
        text: element.textContent,
        tooltipTarget: element.getAttribute('data-tooltip-target'),
        accessibleText: element.nextElementSibling?.textContent,
      })),
      [
        {
          text: '11111111',
          tooltipTarget: 'true',
          accessibleText: '1'.repeat(40),
        },
        {
          text: '22222222',
          tooltipTarget: 'true',
          accessibleText: '2'.repeat(40),
        },
        {
          text: '22222222',
          tooltipTarget: 'true',
          accessibleText: '2'.repeat(40),
        },
        {
          text: '33333333',
          tooltipTarget: 'true',
          accessibleText: '3'.repeat(40),
        },
      ]
    )
    assert.ok(
      screen.getByRole('region', { name: 'Incoming commits' }),
      'incoming commits should retain list semantics inside a named scroll region'
    )
    assert.ok(
      screen.getByRole('region', { name: 'Incoming changed files' }),
      'changed files should retain list semantics inside a named scroll region'
    )

    const buttonGroup = view.container.querySelector(
      '.dialog-footer > .button-group'
    )
    assert.ok(
      buttonGroup,
      'responsive footer styles require a real button group'
    )
    assert.deepEqual(
      Array.from(buttonGroup.querySelectorAll('button')).map(
        button => button.textContent
      ),
      ['Cancel', 'Refresh preview', 'Pull reviewed commit']
    )

    const currentOidTarget = oidElements[0]
    assert.ok(currentOidTarget)
    enableTestTimers(['setTimeout'])
    try {
      fireEvent.mouseEnter(currentOidTarget, { clientX: 20, clientY: 20 })
      advanceTimersBy(400)
      assert.equal(
        screen.getByRole('tooltip', { hidden: true }).textContent,
        '1'.repeat(40)
      )
    } finally {
      resetTestTimers()
    }

    fireEvent.click(
      screen.getByRole('button', { name: 'Pull reviewed commit' })
    )

    await waitFor(() => assert.strictEqual(pulls.length, 1))
    assert.strictEqual(pulls[0].repository, repository)
    assert.strictEqual(pulls[0].prepared, prepared)
    await waitFor(() => assert.strictEqual(dismissed, 1))
  })

  it('locks the uncancellable initial fetch until the review is ready', async () => {
    const preparation = deferred<IPreparedPullPreview>()
    let dismissed = 0
    const view = renderDialog(
      createDispatcher(async () => preparation.promise),
      () => dismissed++
    )

    assert.ok(
      await screen.findByText(
        'Fetching the latest upstream state without changing your worktree…'
      )
    )
    assert.strictEqual(
      view.container.querySelector('.dialog-header button.close'),
      null
    )
    assert.strictEqual(view.container.querySelector('.dialog-footer'), null)
    assert.strictEqual(screen.queryByRole('button', { name: 'Cancel' }), null)

    preparation.resolve(createPrepared())
    assert.ok(await screen.findByText('Finish reviewed pull'))
    assert.ok(view.container.querySelector('.dialog-header button.close'))

    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }))
    assert.strictEqual(dismissed, 1)
  })

  it('disables confirmation for dirty and conflicted worktrees', async () => {
    const cases: ReadonlyArray<{
      readonly state: PullPreviewWorktreeState
      readonly warning: string
    }> = [
      {
        state: 'dirty',
        warning:
          'Commit or stash local changes, then refresh this preview before pulling.',
      },
      {
        state: 'conflicted',
        warning:
          'Resolve the current conflicts, then refresh this preview before pulling.',
      },
    ]

    for (const testCase of cases) {
      let pullCalls = 0
      const view = renderDialog(
        createDispatcher(
          async () => createPrepared(createPreview(), testCase.state),
          async () => {
            pullCalls++
          }
        )
      )

      assert.ok(await screen.findByText(testCase.warning))
      const confirm = screen.getByRole('button', {
        name: 'Pull reviewed commit',
      })
      assert.strictEqual(confirm.getAttribute('aria-disabled'), 'true')

      fireEvent.click(confirm)
      assert.strictEqual(pullCalls, 0)
      view.unmount()
    }
  })

  it('invalidates a failed snapshot until a refreshed review succeeds', async () => {
    const stalePreview = createPreview()
    const refreshedPreview = createPreview({
      upstreamOid: '4'.repeat(40),
      behind: 1,
      incomingCommits: [
        { sha: '4'.repeat(40), summary: 'Newly refreshed commit' },
      ],
    })
    const preparations = [
      createPrepared(stalePreview),
      createPrepared(refreshedPreview),
    ]
    let prepareCalls = 0
    const accepted = new Array<IPullPreview>()
    let dismissed = 0

    renderDialog(
      createDispatcher(
        async () => preparations[Math.min(prepareCalls++, 1)],
        async (_candidate, prepared) => {
          assert.equal(prepared.result.kind, 'ready')
          if (prepared.result.kind !== 'ready') {
            return
          }
          accepted.push(prepared.result)
          if (accepted.length === 1) {
            throw new PullPreviewError('stale-preview')
          }
        }
      ),
      () => dismissed++
    )

    assert.ok(await screen.findByText('Finish reviewed pull'))
    fireEvent.click(
      screen.getByRole('button', { name: 'Pull reviewed commit' })
    )

    assert.ok(
      await screen.findByText(
        'The local branch or upstream changed after review. Refresh the preview before pulling.'
      )
    )
    assert.strictEqual(screen.queryByText('Finish reviewed pull'), null)

    const disabledConfirm = screen.getByRole('button', {
      name: 'Pull reviewed commit',
    })
    assert.strictEqual(disabledConfirm.getAttribute('aria-disabled'), 'true')
    fireEvent.click(disabledConfirm)
    assert.strictEqual(accepted.length, 1)

    fireEvent.click(screen.getByRole('button', { name: 'Refresh preview' }))
    assert.ok(await screen.findByText('Newly refreshed commit'))

    const refreshedConfirm = screen.getByRole('button', {
      name: 'Pull reviewed commit',
    })
    assert.strictEqual(refreshedConfirm.getAttribute('aria-disabled'), null)
    fireEvent.click(refreshedConfirm)

    await waitFor(() => assert.strictEqual(accepted.length, 2))
    assert.strictEqual(accepted[0], stalePreview)
    assert.strictEqual(accepted[1], refreshedPreview)
    await waitFor(() => assert.strictEqual(dismissed, 1))
  })

  it('guards against two synchronous submissions while a pull is pending', async () => {
    const completion = deferred<void>()
    let pullCalls = 0
    let dismissed = 0

    renderDialog(
      createDispatcher(
        async () => createPrepared(),
        async () => {
          pullCalls++
          return completion.promise
        }
      ),
      () => dismissed++
    )

    assert.ok(await screen.findByText('Finish reviewed pull'))
    const form = screen.getByRole('dialog').querySelector('form')
    assert.ok(form)

    fireEvent.submit(form)
    fireEvent.submit(form)
    assert.strictEqual(pullCalls, 1)
    assert.ok(await screen.findByText('Pulling reviewed commit…'))
    assert.strictEqual(screen.queryByRole('button', { name: 'Cancel' }), null)

    completion.resolve(undefined)
    await waitFor(() => assert.strictEqual(dismissed, 1))
  })

  it('surfaces a confirmed pull failure after an unexpected unmount', async () => {
    const completion = deferred<void>()
    const errors = new Array<Error>()
    const failure = new PullPreviewError('pull-failed')
    const view = renderDialog(
      createDispatcher(
        async () => createPrepared(),
        async () => completion.promise,
        async error => {
          errors.push(error)
        }
      )
    )

    assert.ok(await screen.findByText('Finish reviewed pull'))
    fireEvent.click(
      screen.getByRole('button', { name: 'Pull reviewed commit' })
    )
    assert.ok(await screen.findByText('Pulling reviewed commit…'))
    view.unmount()

    completion.reject(failure)
    await waitFor(() => assert.deepEqual(errors, [failure]))
  })

  it('renders English, playful Cantonese, and bilingual review controls', async () => {
    const cases = [
      {
        mode: 'english',
        title: 'Preview pull',
        pull: 'Pull reviewed commit',
        commits: 'Incoming commits',
      },
      {
        mode: 'cantonese',
        title: '預覽 Pull',
        pull: 'Pull 已覆核 commit',
        commits: '即將拉入嘅 commit',
      },
      {
        mode: 'bilingual',
        title: 'Preview pull · 預覽 Pull',
        pull: 'Pull reviewed commit · Pull 已覆核 commit',
        commits: 'Incoming commits · 即將拉入嘅 commit',
      },
    ] as const

    for (const testCase of cases) {
      localStorage.setItem(LanguageModeStorageKey, testCase.mode)
      const view = renderDialog(createDispatcher(async () => createPrepared()))

      assert.ok(await screen.findByRole('heading', { name: testCase.title }))
      assert.ok(screen.getByText(testCase.commits))
      assert.ok(screen.getByRole('button', { name: testCase.pull }))
      view.unmount()
    }
  })
})
