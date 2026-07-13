import assert from 'node:assert'
import { describe, it } from 'node:test'
import * as React from 'react'

import {
  EffectiveBranchRulesError,
  IEffectiveBranchRules,
  synthesizeEffectiveBranchRules,
} from '../../../src/lib/effective-branch-rules'
import { BranchRulesInspector } from '../../../src/ui/branch-rules'
import { DialogStackContext } from '../../../src/ui/dialog'
import { fireEvent, render, screen, waitFor } from '../../helpers/ui/render'

class FakeBranchRulesClient {
  public readonly calls = new Array<{
    branch: string
    signal: AbortSignal
    bypassCache: boolean
  }>()

  public constructor(
    private readonly implementation: (
      branch: string,
      signal: AbortSignal
    ) => Promise<IEffectiveBranchRules>
  ) {}

  public load = (
    branch: string,
    signal: AbortSignal,
    options?: { readonly bypassCache?: boolean }
  ) => {
    this.calls.push({
      branch,
      signal,
      bypassCache: options?.bypassCache === true,
    })
    return this.implementation(branch, signal)
  }
}

function resultFor(branch: string): IEffectiveBranchRules {
  const longValue = `required/${'long-value-without-a-break-'.repeat(12)}`
  return synthesizeEffectiveBranchRules({
    branch,
    repositoryURL: 'https://github.com/desktop/desktop-material',
    repositoryPermission: 'write',
    repositoryArchived: false,
    repositoryDisabled: false,
    repositoryIsFork: false,
    repositoryHasPullRequests: true,
    repositoryPullRequestCreationPolicy: 'all',
    repositoryMergeMethods: ['merge', 'squash', 'rebase'],
    defaultBranch: 'provider-default',
    classic: {
      kind: 'available',
      value: {
        protectionConfigured: true,
        pushAllowed: true,
        pullRequestRequired: true,
        requiredReviewCount: 2,
        requiredChecks: [longValue],
        requiredSignatures: true,
        requiredLinearHistory: true,
        deletionsAllowed: false,
        forcePushesAllowed: false,
        strictChecks: true,
        dismissStaleReviews: true,
        codeOwnerReviews: true,
        lastPushApproval: true,
        conversationResolution: true,
        locked: false,
        enforceAdmins: true,
      },
    },
    rulesets: {
      kind: 'available',
      value: {
        rules: [
          {
            type: 'required_deployments',
            ruleset_id: 12,
            parameters: {
              required_deployment_environments: [longValue],
            },
          },
          { type: 'merge_queue', ruleset_id: 12 },
        ],
        rulesets: new Map([
          [
            12,
            {
              id: 12,
              name: `Release ${'source-name-'.repeat(12)}`,
              source: 'desktop',
              current_user_can_bypass: 'never',
              _links: {
                html: {
                  href: 'https://github.com/organizations/desktop/settings/rules/12',
                },
              },
            },
          ],
        ]),
      },
    },
    fetchedAt: Date.parse('2026-07-13T12:00:00Z'),
  })
}

function renderInspector(
  client: FakeBranchRulesClient | undefined,
  overrides: Partial<React.ComponentProps<typeof BranchRulesInspector>> = {},
  contextOverrides: Partial<React.ContextType<typeof DialogStackContext>> = {}
) {
  let frontRequests = 0
  let dismissals = 0
  const props: React.ComponentProps<typeof BranchRulesInspector> = {
    repositoryLabel: 'desktop/desktop-material',
    repositoryPath: 'C:/repositories/desktop-material',
    initialBranch: 'main',
    currentBranch: 'main',
    isSelectedRepository: true,
    availability: 'ready',
    requestContext: 'github.com:desktop',
    client,
    onDismissed: () => dismissals++,
    ...overrides,
  }
  const view = render(
    <DialogStackContext.Provider
      value={{
        isTopMost: true,
        onRequestFront: () => frontRequests++,
        ...contextOverrides,
      }}
    >
      <BranchRulesInspector {...props} />
    </DialogStackContext.Provider>
  )
  return {
    ...view,
    props,
    getFrontRequests: () => frontRequests,
    getDismissals: () => dismissals,
  }
}

describe('effective branch rules inspector', () => {
  it('loads and renders plain-language requirements, operations, and source links', async () => {
    const client = new FakeBranchRulesClient(branch =>
      Promise.resolve(resultFor(branch))
    )
    renderInspector(client)

    await screen.findByText('Effective state for main')
    assert.equal(client.calls.length, 1)
    assert.equal(client.calls[0].branch, 'main')
    assert.ok(screen.getByRole('dialog', { name: 'Effective branch rules' }))
    assert.ok(screen.getByText('Pull requests and reviews'))
    assert.ok(screen.getByText('Checks and merge gates'))
    assert.ok(screen.getByText('Commit history'))
    assert.ok(screen.getByText('Branch-policy operation state'))
    assert.ok(screen.getByText('Review these policy details'))
    assert.equal(screen.queryByText('Some state remains unknown'), null)
    assert.match(
      screen.getByText('Approvals').parentElement?.textContent ?? '',
      /Required/
    )
    assert.match(
      screen.getByText('Deletion policy').parentElement?.textContent ?? '',
      /Blocked/
    )
    assert.match(
      screen.getByText('Force-push policy').parentElement?.textContent ?? '',
      /Blocked/
    )
    const longValues = screen.getAllByText(/required\/long-value/)
    assert.equal(longValues.length, 2)
    assert.ok(longValues.every(value => value.tagName === 'CODE'))

    const link = screen.getByRole('link', {
      name: /Open source ruleset Release/,
    })
    assert.equal(
      link.getAttribute('href'),
      'https://github.com/organizations/desktop/settings/rules/12'
    )
    assert.equal(screen.queryByText(/\/repos\//), null)
    assert.equal(screen.queryByText(/gh api|raw json|endpoint/i), null)
  })

  it('labels partial counts and value lists without presenting them as exact', async () => {
    const client = new FakeBranchRulesClient(branch => {
      const result = resultFor(branch)
      return Promise.resolve({
        ...result,
        reviews: { ...result.reviews, count: 2, countComplete: false },
        checks: { ...result.checks, valuesComplete: false },
        deployments: { ...result.deployments, valuesComplete: false },
        unknownRuleTypes: ['pull_request.required_reviewers'],
      })
    })
    renderInspector(client)

    await screen.findByText(/At least 2 approving reviews/)
    assert.ok(screen.getByText('Additional required check names may apply.'))
    assert.ok(
      screen.getAllByText(
        'Additional required deployment environments may apply.'
      ).length >= 1
    )
    assert.ok(screen.getByText('pull request required reviewers'))
    assert.equal(screen.queryByText('pull_request.required_reviewers'), null)
  })

  it('renders deterministic repository-context operation reasons separately from warnings', async () => {
    const reason =
      "Deletion is blocked because this is GitHub's default branch."
    renderInspector(
      new FakeBranchRulesClient(branch =>
        Promise.resolve({
          ...resultFor(branch),
          operationDetails: [reason],
          warnings: ['The repository archive state could not be verified.'],
        })
      )
    )

    await screen.findByText(reason)
    assert.ok(screen.getByText('Review these policy details'))
    assert.ok(screen.getByText(/archive state could not be verified/i))
  })

  it('focuses an in-dialog close control when opened', async () => {
    const client = new FakeBranchRulesClient(branch =>
      Promise.resolve(resultFor(branch))
    )
    renderInspector(client)

    await waitFor(() =>
      assert.equal(
        document.activeElement,
        screen.getByRole('button', { name: 'Close effective branch rules' })
      )
    )
  })

  it('requests the front when a background sheet receives focus or a click', async () => {
    const origin = document.createElement('button')
    document.body.appendChild(origin)
    origin.focus()
    const client = new FakeBranchRulesClient(branch =>
      Promise.resolve(resultFor(branch))
    )
    const view = renderInspector(client, {}, { isTopMost: false })
    await screen.findByText('Effective state for main')
    assert.equal(view.getFrontRequests(), 0)
    assert.equal(document.activeElement, origin)

    const dialog = screen.getByRole('dialog')
    fireEvent.focus(dialog)
    assert.equal(view.getFrontRequests(), 1)
    fireEvent.mouseDown(dialog)
    assert.equal(view.getFrontRequests(), 2)
    view.unmount()
    origin.remove()
  })

  it('claims focus when it becomes topmost and restores prior focus on close', async () => {
    const origin = document.createElement('button')
    document.body.appendChild(origin)
    origin.focus()
    const client = new FakeBranchRulesClient(branch =>
      Promise.resolve(resultFor(branch))
    )
    const view = renderInspector(client, {}, { isTopMost: false })
    await screen.findByText('Effective state for main')
    assert.equal(document.activeElement, origin)

    view.rerender(
      <DialogStackContext.Provider value={{ isTopMost: true }}>
        <BranchRulesInspector {...view.props} />
      </DialogStackContext.Provider>
    )
    const close = screen.getByRole('button', {
      name: 'Close effective branch rules',
    })
    await waitFor(() => assert.equal(document.activeElement, close))

    view.unmount()
    assert.equal(document.activeElement, origin)
    origin.remove()
  })

  it('shows signed-out and unsupported states without issuing a request', () => {
    const signedOut = renderInspector(undefined, {
      availability: 'signed-out',
    })
    assert.ok(screen.getByText('Sign in to inspect branch rules'))
    signedOut.unmount()

    renderInspector(undefined, {
      availability: 'unsupported',
      unavailableMessage: 'This provider does not expose GitHub branch rules.',
    })
    assert.ok(screen.getByText('Branch rules are unavailable here'))
    assert.ok(
      screen.getByText('This provider does not expose GitHub branch rules.')
    )
  })

  it('dismisses before opening account or repository account settings', () => {
    const calls = new Array<string>()
    const signedOut = renderInspector(undefined, {
      availability: 'signed-out',
      onDismissed: () => calls.push('dismiss-account'),
      onSignIn: () => calls.push('account-settings'),
    })
    fireEvent.click(
      screen.getByRole('button', { name: 'Open account settings' })
    )
    assert.deepEqual(calls, ['dismiss-account', 'account-settings'])
    signedOut.unmount()

    renderInspector(undefined, {
      availability: 'account-selection-required',
      onDismissed: () => calls.push('dismiss-repository'),
      onChooseRepositoryAccount: () => calls.push('repository-settings'),
    })
    fireEvent.click(
      screen.getByRole('button', { name: 'Open repository settings' })
    )
    assert.deepEqual(calls, [
      'dismiss-account',
      'account-settings',
      'dismiss-repository',
      'repository-settings',
    ])
  })

  it('shows an explicit error instead of a blank ready state without a client', () => {
    renderInspector(undefined)

    assert.ok(screen.getByText('Branch rules could not be loaded'))
    assert.ok(screen.getByText(/branch-rules client is unavailable/i))
  })

  it('shows a permission-specific error and never converts it to an empty state', async () => {
    const client = new FakeBranchRulesClient(() =>
      Promise.reject(
        new EffectiveBranchRulesError(
          'permission',
          'GitHub did not allow this account to read branch protection.'
        )
      )
    )
    renderInspector(client)

    await screen.findByText('GitHub did not grant access')
    assert.ok(
      screen.getByText(
        'GitHub did not allow this account to read branch protection.'
      )
    )
    assert.equal(
      screen.queryByText('No active branch requirements were returned.'),
      null
    )
    await waitFor(() =>
      assert.equal(
        document.activeElement,
        screen.getByRole('button', { name: 'Try again' })
      )
    )
  })

  it('offers the matching recovery destination for authentication and permission failures', async () => {
    let openedAccount = 0
    const authentication = renderInspector(
      new FakeBranchRulesClient(() =>
        Promise.reject(
          new EffectiveBranchRulesError('authentication', 'Sign in again.')
        )
      ),
      { onSignIn: () => openedAccount++ }
    )
    await screen.findByText('GitHub could not authenticate this account')
    fireEvent.click(
      screen.getByRole('button', { name: 'Open account settings' })
    )
    assert.equal(authentication.getDismissals(), 1)
    assert.equal(openedAccount, 1)
    authentication.unmount()

    let openedRepository = 0
    const permission = renderInspector(
      new FakeBranchRulesClient(() =>
        Promise.reject(
          new EffectiveBranchRulesError('permission', 'Choose an account.')
        )
      ),
      { onChooseRepositoryAccount: () => openedRepository++ }
    )
    await screen.findByText('GitHub did not grant access')
    fireEvent.click(
      screen.getByRole('button', { name: 'Open repository settings' })
    )
    assert.equal(permission.getDismissals(), 1)
    assert.equal(openedRepository, 1)
  })

  it('does not steal external focus when a background load fails', async () => {
    const origin = document.createElement('button')
    document.body.appendChild(origin)
    origin.focus()
    const view = renderInspector(
      new FakeBranchRulesClient(() =>
        Promise.reject(
          new EffectiveBranchRulesError('network', 'Network unavailable.')
        )
      ),
      {},
      { isTopMost: false }
    )

    await screen.findByText('Branch rules could not be loaded')
    assert.equal(document.activeElement, origin)
    view.unmount()
    origin.remove()
  })

  it('does not reclaim external focus when a managed refresh succeeds', async () => {
    let request = 0
    let resolveRefresh: ((result: IEffectiveBranchRules) => void) | undefined
    const client = new FakeBranchRulesClient(branch => {
      request++
      return request === 1
        ? Promise.resolve(resultFor(branch))
        : new Promise(resolve => {
            resolveRefresh = resolve
          })
    })
    const view = renderInspector(client)
    await screen.findByText('Effective state for main')

    fireEvent.click(
      screen.getByRole('button', { name: 'Refresh effective branch rules' })
    )
    const cancel = await screen.findByRole('button', {
      name: 'Cancel loading',
    })
    await waitFor(() => assert.equal(document.activeElement, cancel))

    const outside = document.createElement('button')
    document.body.appendChild(outside)
    outside.focus()
    resolveRefresh?.(resultFor('main'))

    await screen.findByText('Effective state for main')
    assert.equal(document.activeElement, outside)
    view.unmount()
    outside.remove()
  })

  it('does not reclaim external focus when a managed refresh fails', async () => {
    let request = 0
    let rejectRefresh: ((error: Error) => void) | undefined
    const client = new FakeBranchRulesClient(branch => {
      request++
      return request === 1
        ? Promise.resolve(resultFor(branch))
        : new Promise<IEffectiveBranchRules>((_resolve, reject) => {
            rejectRefresh = reject
          })
    })
    const view = renderInspector(client)
    await screen.findByText('Effective state for main')

    fireEvent.click(
      screen.getByRole('button', { name: 'Refresh effective branch rules' })
    )
    const cancel = await screen.findByRole('button', {
      name: 'Cancel loading',
    })
    await waitFor(() => assert.equal(document.activeElement, cancel))

    const outside = document.createElement('button')
    document.body.appendChild(outside)
    outside.focus()
    rejectRefresh?.(
      new EffectiveBranchRulesError('network', 'Network unavailable.')
    )

    await screen.findByText('Branch rules could not be loaded')
    assert.equal(document.activeElement, outside)
    view.unmount()
    outside.remove()
  })

  it('keeps managed refresh focus inside when the user stays in the sheet', async () => {
    let request = 0
    const pending = new Array<{
      resolve: (result: IEffectiveBranchRules) => void
      reject: (error: Error) => void
    }>()
    const client = new FakeBranchRulesClient(branch => {
      request++
      return request === 1
        ? Promise.resolve(resultFor(branch))
        : new Promise<IEffectiveBranchRules>((resolve, reject) => {
            pending.push({ resolve, reject })
          })
    })
    renderInspector(client)
    await screen.findByText('Effective state for main')

    fireEvent.click(
      screen.getByRole('button', { name: 'Refresh effective branch rules' })
    )
    await waitFor(() =>
      assert.equal(
        document.activeElement,
        screen.getByRole('button', { name: 'Cancel loading' })
      )
    )
    pending[0].resolve(resultFor('main'))
    await waitFor(() =>
      assert.equal(
        document.activeElement,
        screen.getByRole('button', { name: 'Close effective branch rules' })
      )
    )

    fireEvent.click(
      screen.getByRole('button', { name: 'Refresh effective branch rules' })
    )
    await waitFor(() =>
      assert.equal(
        document.activeElement,
        screen.getByRole('button', { name: 'Cancel loading' })
      )
    )
    pending[1].reject(
      new EffectiveBranchRulesError('network', 'Network unavailable.')
    )
    await waitFor(() =>
      assert.equal(
        document.activeElement,
        screen.getByRole('button', { name: 'Try again' })
      )
    )
  })

  it('clears an old result while refreshing and does not show it after failure', async () => {
    let request = 0
    let rejectRefresh: ((error: Error) => void) | undefined
    const client = new FakeBranchRulesClient(branch => {
      request++
      return request === 1
        ? Promise.resolve(resultFor(branch))
        : new Promise<IEffectiveBranchRules>((_resolve, reject) => {
            rejectRefresh = reject
          })
    })
    renderInspector(client)
    await screen.findByText('Effective state for main')

    fireEvent.click(
      screen.getByRole('button', { name: 'Refresh effective branch rules' })
    )

    assert.equal(client.calls[1].bypassCache, true)
    assert.equal(screen.queryByText('Effective state for main'), null)
    assert.ok(screen.getByText('Loading effective rules…'))
    rejectRefresh?.(
      new EffectiveBranchRulesError(
        'network',
        'A network error prevented branch rules from loading.'
      )
    )
    await screen.findByText('Branch rules could not be loaded')
    assert.equal(screen.queryByText('Effective state for main'), null)
  })

  it('cancels the exact in-flight request and exposes a retry', async () => {
    const client = new FakeBranchRulesClient(
      () => new Promise<IEffectiveBranchRules>(() => {})
    )
    renderInspector(client)
    await screen.findByText('Loading effective rules…')

    fireEvent.click(screen.getByRole('button', { name: 'Cancel loading' }))
    assert.equal(client.calls.length, 1)
    assert.equal(client.calls[0].signal.aborted, true)
    assert.ok(screen.getByText('Loading cancelled'))
    const loadAgain = screen.getByRole('button', { name: 'Load again' })
    await waitFor(() => assert.equal(document.activeElement, loadAgain))
  })

  it('rejects a stale response after the checked-out branch changes', async () => {
    const resolvers = new Map<string, (value: IEffectiveBranchRules) => void>()
    const client = new FakeBranchRulesClient(
      branch =>
        new Promise(resolve => {
          resolvers.set(branch, resolve)
        })
    )
    const view = renderInspector(client)
    await screen.findByText('Loading effective rules…')

    view.rerender(
      <DialogStackContext.Provider value={{ isTopMost: true }}>
        <BranchRulesInspector {...view.props} currentBranch="release/next" />
      </DialogStackContext.Provider>
    )

    await screen.findByText('Inspector context changed')
    assert.equal(client.calls[0].signal.aborted, true)
    resolvers.get('main')?.(resultFor('main'))
    await Promise.resolve()
    assert.equal(screen.queryByText('Effective state for main'), null)

    fireEvent.click(
      screen.getByRole('button', { name: 'Inspect current branch' })
    )
    await waitFor(() => assert.equal(client.calls.length, 2))
    assert.equal(client.calls[1].branch, 'release/next')
    resolvers.get('release/next')?.(resultFor('release/next'))
    await screen.findByText('Effective state for release/next')
  })

  it('reloads after the checked-out branch returns to the inspected target', async () => {
    const resolvers = new Array<(value: IEffectiveBranchRules) => void>()
    const client = new FakeBranchRulesClient(
      () =>
        new Promise(resolve => {
          resolvers.push(resolve)
        })
    )
    const view = renderInspector(client)
    await screen.findByText('Loading effective rules…')

    view.rerender(
      <DialogStackContext.Provider value={{ isTopMost: true }}>
        <BranchRulesInspector {...view.props} currentBranch="release/next" />
      </DialogStackContext.Provider>
    )

    await screen.findByText('Inspector context changed')
    assert.equal(client.calls[0].signal.aborted, true)

    view.rerender(
      <DialogStackContext.Provider value={{ isTopMost: true }}>
        <BranchRulesInspector {...view.props} currentBranch="main" />
      </DialogStackContext.Provider>
    )

    await waitFor(() => assert.equal(client.calls.length, 2))
    assert.equal(client.calls[1].branch, 'main')
    assert.equal(client.calls[1].signal.aborted, false)

    resolvers[0](resultFor('main'))
    await Promise.resolve()
    assert.equal(screen.queryByText('Effective state for main'), null)

    resolvers[1](resultFor('main'))
    await screen.findByText('Effective state for main')
  })

  it('adopts and loads a branch checked out after the sheet opens', async () => {
    const client = new FakeBranchRulesClient(branch =>
      Promise.resolve(resultFor(branch))
    )
    const view = renderInspector(client, {
      initialBranch: null,
      currentBranch: null,
    })
    assert.ok(screen.getByText('No checked-out branch'))
    assert.equal(client.calls.length, 0)

    view.rerender(
      <DialogStackContext.Provider value={{ isTopMost: true }}>
        <BranchRulesInspector {...view.props} currentBranch="feature/ready" />
      </DialogStackContext.Provider>
    )

    await screen.findByText('Effective state for feature/ready')
    assert.equal(client.calls.length, 1)
    assert.equal(client.calls[0].branch, 'feature/ready')
  })

  it('aborts and clears results when account availability changes', async () => {
    const firstClient = new FakeBranchRulesClient(
      () => new Promise<IEffectiveBranchRules>(() => {})
    )
    const view = renderInspector(firstClient)
    await screen.findByText('Loading effective rules…')

    view.rerender(
      <DialogStackContext.Provider value={{ isTopMost: true }}>
        <BranchRulesInspector
          {...view.props}
          availability="signed-out"
          requestContext="signed-out"
          client={undefined}
        />
      </DialogStackContext.Provider>
    )

    assert.equal(firstClient.calls[0].signal.aborted, true)
    assert.ok(await screen.findByText('Sign in to inspect branch rules'))
    assert.equal(screen.queryByText('Loading cancelled'), null)
  })

  it('shows stale repository context before an unsupported availability state', async () => {
    const client = new FakeBranchRulesClient(
      () => new Promise<IEffectiveBranchRules>(() => {})
    )
    const view = renderInspector(client)
    await screen.findByText('Loading effective rules…')

    view.rerender(
      <DialogStackContext.Provider value={{ isTopMost: true }}>
        <BranchRulesInspector
          {...view.props}
          availability="unsupported"
          isSelectedRepository={false}
          currentBranch={null}
          client={undefined}
          unavailableMessage="A checked-out branch is required."
        />
      </DialogStackContext.Provider>
    )

    assert.equal(client.calls[0].signal.aborted, true)
    assert.ok(await screen.findByText('Inspector context changed'))
    assert.ok(screen.getByText(/A different repository is selected/))
    assert.equal(screen.queryByText('Branch rules are unavailable here'), null)
    assert.equal(screen.queryByText('A checked-out branch is required.'), null)
  })

  it('reloads with the new account when the request context changes', async () => {
    const firstClient = new FakeBranchRulesClient(
      () => new Promise<IEffectiveBranchRules>(() => {})
    )
    const secondClient = new FakeBranchRulesClient(branch =>
      Promise.resolve(resultFor(branch))
    )
    const view = renderInspector(firstClient)
    await screen.findByText('Loading effective rules…')

    view.rerender(
      <DialogStackContext.Provider value={{ isTopMost: true }}>
        <BranchRulesInspector
          {...view.props}
          requestContext="github.com:octocat"
          client={secondClient}
        />
      </DialogStackContext.Provider>
    )

    assert.equal(firstClient.calls[0].signal.aborted, true)
    await screen.findByText('Effective state for main')
    assert.equal(secondClient.calls.length, 1)
  })

  it('reloads when the resolved client changes under the same request key', async () => {
    const firstClient = new FakeBranchRulesClient(
      () => new Promise<IEffectiveBranchRules>(() => {})
    )
    const secondClient = new FakeBranchRulesClient(branch =>
      Promise.resolve(resultFor(branch))
    )
    const view = renderInspector(firstClient)
    await screen.findByText('Loading effective rules…')

    view.rerender(
      <DialogStackContext.Provider value={{ isTopMost: true }}>
        <BranchRulesInspector {...view.props} client={secondClient} />
      </DialogStackContext.Provider>
    )

    assert.equal(firstClient.calls[0].signal.aborted, true)
    await screen.findByText('Effective state for main')
    assert.equal(secondClient.calls.length, 1)
  })

  it('preserves focused loading controls across a client-context reload', async () => {
    const firstClient = new FakeBranchRulesClient(
      () => new Promise<IEffectiveBranchRules>(() => {})
    )
    const secondClient = new FakeBranchRulesClient(
      () => new Promise<IEffectiveBranchRules>(() => {})
    )
    const view = renderInspector(firstClient)
    const firstCancel = await screen.findByRole('button', {
      name: 'Cancel loading',
    })
    firstCancel.focus()
    assert.equal(document.activeElement, firstCancel)

    view.rerender(
      <DialogStackContext.Provider value={{ isTopMost: true }}>
        <BranchRulesInspector {...view.props} client={secondClient} />
      </DialogStackContext.Provider>
    )

    assert.equal(firstClient.calls[0].signal.aborted, true)
    await waitFor(() => {
      const replacement = screen.getByRole('button', {
        name: 'Cancel loading',
      })
      assert.equal(document.activeElement, replacement)
    })
    assert.equal(secondClient.calls.length, 1)
  })

  it('uses Escape to cancel loading and Ctrl-W to close the sheet', async () => {
    const client = new FakeBranchRulesClient(
      () => new Promise<IEffectiveBranchRules>(() => {})
    )
    const view = renderInspector(client)
    await screen.findByText('Loading effective rules…')

    fireEvent.keyDown(window, { key: 'Escape' })
    assert.equal(client.calls[0].signal.aborted, true)
    assert.equal(view.getDismissals(), 0)
    assert.ok(screen.getByText('Loading cancelled'))

    fireEvent.keyDown(window, {
      key: 'w',
      ctrlKey: !__DARWIN__,
      metaKey: __DARWIN__,
    })
    assert.equal(view.getDismissals(), 1)
  })

  it('does not consume sheet shortcuts from external focus or with extra modifiers', async () => {
    const origin = document.createElement('button')
    document.body.appendChild(origin)
    const view = renderInspector(
      new FakeBranchRulesClient(branch => Promise.resolve(resultFor(branch)))
    )
    await screen.findByText('Effective state for main')

    origin.focus()
    fireEvent.keyDown(window, { key: 'Escape' })
    fireEvent.keyDown(window, {
      key: 'w',
      ctrlKey: !__DARWIN__,
      metaKey: __DARWIN__,
    })
    assert.equal(view.getDismissals(), 0)

    screen.getByRole('button', { name: 'Close effective branch rules' }).focus()
    fireEvent.keyDown(window, {
      key: 'w',
      ctrlKey: !__DARWIN__,
      metaKey: __DARWIN__,
      shiftKey: true,
    })
    fireEvent.keyDown(window, { key: 'Escape', altKey: true })
    assert.equal(view.getDismissals(), 0)
    view.unmount()
    origin.remove()
  })
})
