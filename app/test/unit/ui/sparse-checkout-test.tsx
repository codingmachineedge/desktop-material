import assert from 'node:assert'
import { describe, it, mock } from 'node:test'
import * as React from 'react'

import { Repository } from '../../../src/models/repository'
import { parseSparseCheckoutDirectories } from '../../../src/lib/git/sparse-checkout-parser'
import { DialogStackContext } from '../../../src/ui/dialog'
import {
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from '../../helpers/ui/render'

class TestSparseCheckoutError extends Error {}

mock.module('../../../src/lib/git/sparse-checkout', {
  namedExports: {
    disableSparseCheckout: async () => {},
    getSparseCheckoutState: async () => {
      throw new Error('Use the injected test client.')
    },
    parseSparseCheckoutDirectories,
    reapplySparseCheckout: async () => {},
    setSparseCheckoutDirectories: async () => [],
    SparseCheckoutInputLengthLimit: 256 * 1024,
    SparseCheckoutUnavailableError: TestSparseCheckoutError,
  },
})

const disabledState = {
  supported: true,
  enabled: false,
  coneMode: false,
  entries: [],
  isUnborn: false,
  isSubmodule: false,
  isLinkedWorktree: false,
}

describe('SparseCheckoutManager', () => {
  it('freezes reviewed input, focuses cancellation, and refreshes after exact abort', async () => {
    const signals = new Array<AbortSignal | undefined>()
    const inputs = new Array<string>()
    let refreshes = 0
    let stateLoads = 0
    const client = {
      getState: async () => {
        stateLoads++
        return disabledState
      },
      setDirectories: async (
        _repositoryPath: string,
        input: string,
        signal?: AbortSignal
      ) => {
        inputs.push(input)
        signals.push(signal)
        return new Promise<ReadonlyArray<string>>((_, reject) => {
          signal?.addEventListener(
            'abort',
            () => reject(new TestSparseCheckoutError('cancelled')),
            { once: true }
          )
        })
      },
      reapply: async () => {},
      disable: async () => {},
    }
    const repository = new Repository('C:/repo', -1, null, false)
    let dismissals = 0
    const { SparseCheckoutManager } = await import(
      '../../../src/ui/sparse-checkout/sparse-checkout'
    )

    render(
      <DialogStackContext.Provider value={{ isTopMost: true }}>
        <SparseCheckoutManager
          repository={repository}
          client={client}
          onRefreshRepository={async () => {
            refreshes++
          }}
          onDismissed={() => {
            dismissals++
          }}
        />
      </DialogStackContext.Provider>
    )

    const editor = await screen.findByRole('textbox', {
      name: 'Included directories',
    })
    const workflow = screen.getByRole('list', {
      name: 'Sparse checkout workflow',
    })
    assert.equal(within(workflow).getAllByRole('listitem').length, 3)
    assert.equal(
      within(workflow)
        .getByText('Choose directories')
        .closest('li')
        ?.getAttribute('aria-current'),
      'step'
    )
    assert.ok(
      screen.getByText(
        'Add at least one repository-relative directory to continue.'
      )
    )
    fireEvent.change(editor, { target: { value: '../outside' } })
    assert.ok(screen.getByText('Fix 1 validation issue before review.'))
    fireEvent.change(editor, { target: { value: 'src\\ui/' } })
    assert.ok(screen.getByText('Ready to review 1 directory root.'))
    const review = screen.getByRole('button', { name: 'Review enable' })
    fireEvent.click(review)

    assert.ok(screen.getByRole('alertdialog'))
    assert.equal(
      within(workflow)
        .getByText('Review selection')
        .closest('li')
        ?.getAttribute('aria-current'),
      'step'
    )
    assert.ok(screen.getByText('1 selected directory root will be applied.'))
    assert.equal(
      screen.getByLabelText('Reviewed selection size').textContent,
      'Selected roots1'
    )
    assert.ok(
      screen.getByText(
        'Step 2 is locked to the reviewed selection. Go back to edit it.'
      )
    )
    assert.ok(
      within(
        screen.getByRole('list', { name: 'Reviewed directory selection' })
      ).getByText('src/ui')
    )
    const confirm = screen.getByRole('button', {
      name: 'Apply directory selection',
    })
    await waitFor(() => assert.equal(document.activeElement, confirm))
    assert.equal((editor as HTMLTextAreaElement).disabled, true)
    const refresh = screen.getByRole('button', {
      name: 'Refresh sparse checkout',
    })
    assert.equal(refresh.getAttribute('aria-disabled'), 'true')

    // Event-boundary guards keep the exact reviewed value frozen even if a
    // synthetic event bypasses the disabled DOM controls.
    fireEvent.change(editor, { target: { value: 'different/path' } })
    fireEvent.click(refresh)
    assert.equal(stateLoads, 1)

    fireEvent.click(screen.getByRole('button', { name: 'Go back' }))
    await waitFor(() => assert.equal(document.activeElement, review))
    assert.equal((editor as HTMLTextAreaElement).value, 'src\\ui/')
    assert.equal(dismissals, 0)

    fireEvent.click(review)
    const reviewedConfirm = screen.getByRole('button', {
      name: 'Apply directory selection',
    })
    await waitFor(() => assert.equal(document.activeElement, reviewedConfirm))

    fireEvent.click(reviewedConfirm)
    const cancel = await screen.findByRole('button', {
      name: 'Cancel operation',
    })
    await waitFor(() => assert.equal(document.activeElement, cancel))
    assert.ok(
      screen.getByText(
        'Step 3 is running. You can cancel while Git is changing the worktree.'
      )
    )
    assert.equal(
      within(workflow)
        .getByText('Apply and refresh')
        .closest('li')
        ?.getAttribute('aria-current'),
      'step'
    )
    assert.deepEqual(inputs, ['src/ui'])

    const closeShortcut = __DARWIN__
      ? { key: 'w', metaKey: true }
      : { key: 'w', ctrlKey: true }
    fireEvent.keyDown(window, closeShortcut)
    assert.equal(signals[0]?.aborted, false)
    assert.equal(dismissals, 0)

    fireEvent.keyDown(window, { key: 'Escape' })
    await waitFor(() => assert.equal(signals[0]?.aborted, true))
    await screen.findByText('Operation cancelled. Repository state refreshed.')
    assert.equal(
      within(workflow)
        .getByText('Apply and refresh')
        .closest('li')
        ?.getAttribute('aria-current'),
      'step'
    )
    assert.ok(
      screen.getByText(
        'Step 3 finished. Review the result, then edit the selection or refresh to start again.'
      )
    )
    assert.equal(refreshes, 1)
    assert.ok(stateLoads >= 2)
  })

  it('shows exact enabled-cone changes and keeps the result step until editing resumes', async () => {
    let sparseState = {
      ...disabledState,
      enabled: true,
      coneMode: true,
      entries: ['src', 'docs', 'test'],
    }
    const client = {
      getState: async () => sparseState,
      setDirectories: async (
        _repositoryPath: string,
        input: string
      ): Promise<ReadonlyArray<string>> => {
        const entries = input.split('\n')
        sparseState = { ...sparseState, entries }
        return entries
      },
      reapply: async () => {},
      disable: async () => {},
    }
    const repository = new Repository('C:/repo', -1, null, false)
    const { SparseCheckoutManager } = await import(
      '../../../src/ui/sparse-checkout/sparse-checkout'
    )

    render(
      <DialogStackContext.Provider value={{ isTopMost: true }}>
        <SparseCheckoutManager
          repository={repository}
          client={client}
          onRefreshRepository={async () => {}}
          onDismissed={() => {}}
        />
      </DialogStackContext.Provider>
    )

    const editor = await screen.findByRole('textbox', {
      name: 'Included directories',
    })
    const workflow = screen.getByRole('list', {
      name: 'Sparse checkout workflow',
    })
    fireEvent.change(editor, { target: { value: 'src\npackages' } })
    fireEvent.click(
      screen.getByRole('button', { name: 'Review directory update' })
    )

    const changes = screen.getByLabelText('Selection entry changes')
    assert.equal(
      within(changes).getByText('Added roots').nextElementSibling?.textContent,
      '1'
    )
    assert.equal(
      within(changes).getByText('Removed roots').nextElementSibling
        ?.textContent,
      '2'
    )
    assert.equal(
      within(changes).getByText('Unchanged roots').nextElementSibling
        ?.textContent,
      '1'
    )

    fireEvent.click(
      screen.getByRole('button', { name: 'Apply directory selection' })
    )
    await screen.findByText('Included directories updated.')
    assert.equal(
      within(workflow)
        .getByText('Apply and refresh')
        .closest('li')
        ?.getAttribute('aria-current'),
      'step'
    )

    fireEvent.change(editor, { target: { value: 'src' } })
    assert.equal(
      within(workflow)
        .getByText('Adjust directories')
        .closest('li')
        ?.getAttribute('aria-current'),
      'step'
    )
    assert.ok(screen.getByText('Ready to review 1 directory root.'))
  })

  it('shows every bounded normalized entry in the exact review', async () => {
    const client = {
      getState: async () => disabledState,
      setDirectories: async () => [],
      reapply: async () => {},
      disable: async () => {},
    }
    const repository = new Repository('C:/repo', -1, null, false)
    const { SparseCheckoutManager } = await import(
      '../../../src/ui/sparse-checkout/sparse-checkout'
    )
    const directories = Array.from(
      { length: 13 },
      (_, index) => `packages/package-${index + 1}`
    )

    render(
      <DialogStackContext.Provider value={{ isTopMost: true }}>
        <SparseCheckoutManager
          repository={repository}
          client={client}
          onRefreshRepository={async () => {}}
          onDismissed={() => {}}
        />
      </DialogStackContext.Provider>
    )

    const editor = await screen.findByRole('textbox', {
      name: 'Included directories',
    })
    fireEvent.change(editor, { target: { value: directories.join('\n') } })
    fireEvent.click(screen.getByRole('button', { name: 'Review enable' }))

    const reviewed = screen.getByRole('list', {
      name: 'Reviewed directory selection',
    })
    assert.equal(within(reviewed).getAllByRole('listitem').length, 13)
    assert.ok(within(reviewed).getByText('packages/package-13'))
    assert.equal(screen.queryByText(/Plus \d+ more reviewed/), null)
  })

  it('owns shortcuts only while topmost and focused, and separates review dismissal from closing', async () => {
    let dismissals = 0
    let frontRequests = 0
    const client = {
      getState: async () => disabledState,
      setDirectories: async () => ['src'],
      reapply: async () => {},
      disable: async () => {},
    }
    const repository = new Repository('C:/repo', -1, null, false)
    const { SparseCheckoutManager } = await import(
      '../../../src/ui/sparse-checkout/sparse-checkout'
    )
    const renderManager = (isTopMost: boolean) => (
      <>
        <button type="button">Background action</button>
        <DialogStackContext.Provider
          value={{
            isTopMost,
            onRequestFront: () => {
              frontRequests++
            },
          }}
        >
          <SparseCheckoutManager
            repository={repository}
            client={client}
            onRefreshRepository={async () => {}}
            onDismissed={() => {
              dismissals++
            }}
          />
        </DialogStackContext.Provider>
      </>
    )
    const { rerender } = render(renderManager(true))

    const editor = await screen.findByRole('textbox', {
      name: 'Included directories',
    })
    const panel = screen.getByRole('dialog', { name: 'Sparse checkout' })
    assert.equal(document.activeElement, panel)

    const background = screen.getByRole('button', {
      name: 'Background action',
    })
    background.focus()
    fireEvent.keyDown(window, { key: 'Escape' })
    assert.equal(dismissals, 0)

    editor.focus()
    fireEvent.change(editor, { target: { value: 'src' } })
    const review = screen.getByRole('button', { name: 'Review enable' })
    fireEvent.click(review)
    const confirm = screen.getByRole('button', {
      name: 'Apply directory selection',
    })
    await waitFor(() => assert.equal(document.activeElement, confirm))

    fireEvent.keyDown(window, { key: 'Escape' })
    assert.equal(screen.queryByRole('alertdialog'), null)
    await waitFor(() => assert.equal(document.activeElement, review))
    assert.equal(dismissals, 0)

    fireEvent.click(review)
    const reviewedConfirm = screen.getByRole('button', {
      name: 'Apply directory selection',
    })
    await waitFor(() => assert.equal(document.activeElement, reviewedConfirm))
    fireEvent.keyDown(
      window,
      __DARWIN__ ? { key: 'w', metaKey: true } : { key: 'w', ctrlKey: true }
    )
    assert.equal(dismissals, 1)
    assert.ok(screen.getByRole('alertdialog'))

    rerender(renderManager(false))
    background.focus()
    reviewedConfirm.focus()
    assert.equal(frontRequests, 1)
    fireEvent.keyDown(window, { key: 'Escape' })
    assert.ok(screen.getByRole('alertdialog'))
    assert.equal(dismissals, 1)
  })

  it('reclaims focus and shortcut ownership when reordered ahead of branch rules', async () => {
    let sparseDismissals = 0
    let branchDismissals = 0
    const client = {
      getState: async () => disabledState,
      setDirectories: async () => ['src'],
      reapply: async () => {},
      disable: async () => {},
    }
    const repository = new Repository('C:/repo', -1, null, false)
    const { SparseCheckoutManager } = await import(
      '../../../src/ui/sparse-checkout/sparse-checkout'
    )
    const renderStack = (
      topMost: 'sparse' | 'branch-rules',
      showBranchRules: boolean
    ) => (
      <>
        <DialogStackContext.Provider
          value={{ isTopMost: topMost === 'sparse' }}
        >
          <SparseCheckoutManager
            repository={repository}
            client={client}
            onRefreshRepository={async () => {}}
            onDismissed={() => {
              sparseDismissals++
            }}
          />
        </DialogStackContext.Provider>
        {showBranchRules ? (
          <DialogStackContext.Provider
            value={{ isTopMost: topMost === 'branch-rules' }}
          >
            <button
              type="button"
              onClick={() => {
                branchDismissals++
              }}
            >
              Close effective branch rules
            </button>
          </DialogStackContext.Provider>
        ) : null}
      </>
    )
    const view = render(renderStack('sparse', false))

    await screen.findByRole('textbox', { name: 'Included directories' })
    const sparsePanel = screen.getByRole('dialog', {
      name: 'Sparse checkout',
    })
    assert.equal(document.activeElement, sparsePanel)

    view.rerender(renderStack('branch-rules', true))
    const branchRulesClose = screen.getByRole('button', {
      name: 'Close effective branch rules',
    })
    branchRulesClose.focus()
    assert.equal(document.activeElement, branchRulesClose)

    view.rerender(renderStack('sparse', true))
    await waitFor(() => assert.ok(sparsePanel.contains(document.activeElement)))

    fireEvent.keyDown(window, { key: 'Escape' })
    assert.equal(sparseDismissals, 1)
    assert.equal(branchDismissals, 0)
  })

  it('does not take focus when mounted behind another sheet', async () => {
    const origin = document.createElement('button')
    document.body.appendChild(origin)
    origin.focus()
    const client = {
      getState: async () => disabledState,
      setDirectories: async () => ['src'],
      reapply: async () => {},
      disable: async () => {},
    }
    const repository = new Repository('C:/repo', -1, null, false)
    const { SparseCheckoutManager } = await import(
      '../../../src/ui/sparse-checkout/sparse-checkout'
    )

    const view = render(
      <DialogStackContext.Provider value={{ isTopMost: false }}>
        <SparseCheckoutManager
          repository={repository}
          client={client}
          onRefreshRepository={async () => {}}
          onDismissed={() => {}}
        />
      </DialogStackContext.Provider>
    )

    await screen.findByRole('textbox', { name: 'Included directories' })
    assert.equal(document.activeElement, origin)
    view.unmount()
    origin.remove()
  })

  it('reports cancellation before refresh and does not claim a failed refresh succeeded', async () => {
    const signals = new Array<AbortSignal | undefined>()
    let rejectMutation: ((error: Error) => void) | undefined
    let refreshes = 0
    const client = {
      getState: async () => disabledState,
      setDirectories: async (
        _repositoryPath: string,
        _input: string,
        signal?: AbortSignal
      ) => {
        signals.push(signal)
        return new Promise<ReadonlyArray<string>>((_resolve, reject) => {
          rejectMutation = reject
        })
      },
      reapply: async () => {},
      disable: async () => {},
    }
    const repository = new Repository('C:/repo', -1, null, false)
    const { SparseCheckoutManager } = await import(
      '../../../src/ui/sparse-checkout/sparse-checkout'
    )

    render(
      <DialogStackContext.Provider value={{ isTopMost: true }}>
        <SparseCheckoutManager
          repository={repository}
          client={client}
          onRefreshRepository={async () => {
            refreshes++
            throw new Error('refresh failed')
          }}
          onDismissed={() => {}}
        />
      </DialogStackContext.Provider>
    )

    const editor = await screen.findByRole('textbox', {
      name: 'Included directories',
    })
    fireEvent.change(editor, { target: { value: 'src' } })
    fireEvent.click(screen.getByRole('button', { name: 'Review enable' }))
    fireEvent.click(
      screen.getByRole('button', { name: 'Apply directory selection' })
    )

    const cancel = await screen.findByRole('button', {
      name: 'Cancel operation',
    })
    fireEvent.click(cancel)
    assert.equal(signals[0]?.aborted, true)
    assert.ok(screen.getByText('Cancelling operation…'))
    assert.equal(
      screen.queryByText('Cancelling and refreshing the repository…'),
      null
    )

    assert.ok(rejectMutation !== undefined)
    rejectMutation(new TestSparseCheckoutError('cancelled'))

    await screen.findByText('Operation cancelled.')
    assert.ok(
      screen.getByText(
        'The operation was cancelled, but refreshing the repository view failed.'
      )
    )
    assert.equal(
      screen.queryByText('Operation cancelled. Repository state refreshed.'),
      null
    )
    assert.equal(refreshes, 1)
  })

  it('ignores a mutation that settles after the repository changes', async () => {
    const loads = new Array<string>()
    const signals = new Array<AbortSignal | undefined>()
    let refreshes = 0
    let resolveMutation: ((value: ReadonlyArray<string>) => void) | undefined
    const client = {
      getState: async (repositoryPath: string) => {
        loads.push(repositoryPath)
        return disabledState
      },
      setDirectories: async (
        _repositoryPath: string,
        _input: string,
        signal?: AbortSignal
      ) => {
        signals.push(signal)
        return new Promise<ReadonlyArray<string>>(resolve => {
          resolveMutation = resolve
        })
      },
      reapply: async () => {},
      disable: async () => {},
    }
    const firstRepository = new Repository('C:/first', -1, null, false)
    const secondRepository = new Repository('C:/second', -1, null, false)
    const { SparseCheckoutManager } = await import(
      '../../../src/ui/sparse-checkout/sparse-checkout'
    )
    const renderManager = (repository: Repository) => (
      <DialogStackContext.Provider value={{ isTopMost: true }}>
        <SparseCheckoutManager
          repository={repository}
          client={client}
          onRefreshRepository={async () => {
            refreshes++
          }}
          onDismissed={() => {}}
        />
      </DialogStackContext.Provider>
    )
    const { rerender } = render(renderManager(firstRepository))

    const editor = await screen.findByRole('textbox', {
      name: 'Included directories',
    })
    fireEvent.change(editor, { target: { value: 'src' } })
    fireEvent.click(screen.getByRole('button', { name: 'Review enable' }))
    fireEvent.click(
      screen.getByRole('button', { name: 'Apply directory selection' })
    )
    await screen.findByRole('button', { name: 'Cancel operation' })

    rerender(renderManager(secondRepository))
    await waitFor(() => {
      assert.equal(signals[0]?.aborted, true)
      assert.deepEqual(loads, ['C:/first', 'C:/second'])
    })

    assert.ok(resolveMutation !== undefined)
    resolveMutation([])
    await new Promise(resolve => setTimeout(resolve, 0))

    assert.equal(refreshes, 0)
    assert.deepEqual(loads, ['C:/first', 'C:/second'])
    assert.equal(screen.queryByText('Included directories updated.'), null)
  })

  it('removes cancellation and keeps dismissal available during refresh', async () => {
    let dismissals = 0
    let resolveRefresh: (() => void) | undefined
    const client = {
      getState: async () => disabledState,
      setDirectories: async () => ['src'],
      reapply: async () => {},
      disable: async () => {},
    }
    const repository = new Repository('C:/repo', -1, null, false)
    const { SparseCheckoutManager } = await import(
      '../../../src/ui/sparse-checkout/sparse-checkout'
    )
    render(
      <DialogStackContext.Provider value={{ isTopMost: true }}>
        <SparseCheckoutManager
          repository={repository}
          client={client}
          onRefreshRepository={() =>
            new Promise<void>(resolve => {
              resolveRefresh = resolve
            })
          }
          onDismissed={() => {
            dismissals++
          }}
        />
      </DialogStackContext.Provider>
    )

    const editor = await screen.findByRole('textbox', {
      name: 'Included directories',
    })
    fireEvent.change(editor, { target: { value: 'src' } })
    fireEvent.click(screen.getByRole('button', { name: 'Review enable' }))
    fireEvent.click(
      screen.getByRole('button', { name: 'Apply directory selection' })
    )

    await screen.findByText('Refreshing repository and sparse-checkout state…')
    assert.equal(
      screen.queryByRole('button', { name: 'Cancel operation' }),
      null
    )
    assert.notEqual(
      screen
        .getByRole('button', { name: 'Close sparse checkout' })
        .getAttribute('aria-disabled'),
      'true'
    )
    await waitFor(() =>
      assert.equal(
        document.activeElement,
        screen.getByRole('button', { name: 'Close sparse checkout' })
      )
    )

    fireEvent.keyDown(window, { key: 'Escape' })
    assert.equal(dismissals, 1)

    assert.ok(resolveRefresh !== undefined)
    resolveRefresh()
    await screen.findByText('Included directories updated.')
  })
})
