import assert from 'node:assert'
import { describe, it } from 'node:test'
import * as React from 'react'
import { LanguageModeChangedEvent } from '../../../src/lib/i18n'
import {
  MergeRequestLifecycleActions,
  type IMergeRequestLifecycleActionsProps,
  type IMergeRequestLifecycleSummary,
  type MergeRequestLifecycleAvailability,
} from '../../../src/ui/merge-request/merge-request-lifecycle'
import type {
  IMergeRequestApprovalIntent,
  IMergeRequestRouteIdentity,
} from '../../../src/ui/merge-request/merge-request-model'
import { fireEvent, render, screen, waitFor } from '../../helpers/ui/render'

function route(): IMergeRequestRouteIdentity {
  return {
    repositoryId: 'repository-1',
    accountKey: 'gitlab:https://gitlab.example:test-user',
    accountDisplayName: 'Test User',
    friendlyEndpoint: 'gitlab.example',
    projectPath: 'desktop/material',
  }
}

function summary(
  overrides: Partial<IMergeRequestLifecycleSummary> = {}
): IMergeRequestLifecycleSummary {
  return {
    route: route(),
    mergeRequestIid: 42,
    headSha: 'a'.repeat(64),
    canonicalUrl: 'https://gitlab.example/desktop/material/-/merge_requests/42',
    state: 'opened',
    draft: true,
    author: { id: '1', displayName: 'Author One', username: 'author-one' },
    reviewers: [
      { id: '2', displayName: 'Reviewer One', username: 'reviewer-one' },
    ],
    assignees: [{ id: '3', displayName: 'Assignee One' }],
    approval: {
      approved: false,
      approvalsRequired: 2,
      approvalsLeft: 1,
      approvedBy: [{ id: '4', displayName: 'Approver One' }],
      currentUserApproved: false,
      canApprove: true,
    },
    pipelineStatus: 'running',
    detailedMergeStatus: 'requested_changes',
    updatedAt: '2026-07-20T14:30:00Z',
    ...overrides,
  }
}

function props(
  availability: MergeRequestLifecycleAvailability = {
    kind: 'ready',
    summary: summary(),
  },
  overrides: Partial<IMergeRequestLifecycleActionsProps> = {}
): IMergeRequestLifecycleActionsProps {
  return {
    availability,
    onClose: () => {},
    onReopen: () => {},
    onApprovalChange: () => {},
    onRefresh: () => {},
    onOpenCanonicalUrl: () => {},
    ...overrides,
  }
}

function verification(
  container: HTMLElement,
  value: string
): HTMLElement | null {
  return container.querySelector(`[data-verification="${value}"]`)
}

describe('MergeRequestLifecycleActions', () => {
  it('renders the bounded lifecycle summary and callback-only actions', () => {
    let closes = 0
    let refreshes = 0
    const approvals: IMergeRequestApprovalIntent[] = []
    const opened: string[] = []
    const view = render(
      <MergeRequestLifecycleActions
        {...props(undefined, {
          onClose: () => (closes += 1),
          onApprovalChange: intent => approvals.push(intent),
          onRefresh: () => (refreshes += 1),
          onOpenCanonicalUrl: url => opened.push(url),
        })}
      />
    )

    for (const hook of [
      'merge-request-lifecycle',
      'merge-request-summary',
      'merge-request-state-summary',
      'merge-request-author',
      'merge-request-reviewers-summary',
      'merge-request-assignees-summary',
      'merge-request-approval-summary',
      'merge-request-pipeline-summary',
      'merge-request-readiness-summary',
      'merge-request-updated',
      'merge-request-close',
      'merge-request-approve',
      'merge-request-lifecycle-refresh',
      'merge-request-open-canonical',
    ]) {
      assert.ok(verification(view.container, hook), `missing ${hook}`)
    }
    assert.ok(screen.getByText('Open · Draft'))
    assert.ok(screen.getByText('Author One (@author-one)'))
    assert.ok(screen.getByText('Reviewer One (@reviewer-one)'))
    assert.ok(screen.getByText('Assignee One'))
    assert.ok(
      screen.getByText('1 of 2 required approvals · Approved by Approver One')
    )
    assert.ok(screen.getByText('Running'))
    assert.ok(screen.getByText('Blocked: a reviewer requested changes'))

    fireEvent.click(screen.getByRole('button', { name: 'Close merge request' }))
    fireEvent.click(
      screen.getByRole('button', { name: 'Approve current HEAD' })
    )
    fireEvent.click(screen.getByRole('button', { name: 'Refresh lifecycle' }))
    fireEvent.click(screen.getByRole('button', { name: 'Open on GitLab' }))

    assert.strictEqual(closes, 1)
    assert.strictEqual(refreshes, 1)
    assert.deepStrictEqual(approvals, [
      {
        route: route(),
        mergeRequestIid: 42,
        headSha: 'a'.repeat(64),
        approve: true,
      },
    ])
    assert.deepStrictEqual(opened, [
      'https://gitlab.example/desktop/material/-/merge_requests/42',
    ])
  })

  it('switches close, reopen, approve, and unapprove while guarding stale HEAD state', () => {
    let reopens = 0
    const approvals: IMergeRequestApprovalIntent[] = []
    const closed = summary({
      state: 'closed',
      draft: false,
      approval: {
        approved: true,
        approvalsRequired: 1,
        approvalsLeft: 0,
        approvedBy: [],
        currentUserApproved: true,
        canApprove: true,
      },
    })
    const view = render(
      <MergeRequestLifecycleActions
        {...props(
          { kind: 'ready', summary: closed },
          {
            onReopen: () => (reopens += 1),
            onApprovalChange: intent => approvals.push(intent),
          }
        )}
      />
    )

    fireEvent.click(
      screen.getByRole('button', { name: 'Reopen merge request' })
    )
    fireEvent.click(screen.getByRole('button', { name: 'Remove approval' }))
    assert.strictEqual(reopens, 1)
    assert.strictEqual(approvals[0].approve, false)

    view.rerender(
      <MergeRequestLifecycleActions
        {...props({ kind: 'stale', summary: closed })}
      />
    )
    assert.ok(screen.getByText('Merge-request lifecycle context changed'))
    assert.strictEqual(
      screen
        .getByRole('button', { name: 'Reopen merge request' })
        .getAttribute('aria-disabled'),
      'true'
    )
    assert.strictEqual(
      screen
        .getByRole('button', { name: 'Open on GitLab' })
        .getAttribute('aria-disabled'),
      'true'
    )
    assert.strictEqual(
      screen
        .getByRole('button', { name: 'Refresh lifecycle' })
        .getAttribute('aria-disabled'),
      null
    )

    view.rerender(
      <MergeRequestLifecycleActions
        {...props({
          kind: 'ready',
          summary: summary({ headSha: 'a'.repeat(39) }),
        })}
      />
    )
    assert.strictEqual(
      screen
        .getByRole('button', { name: 'Approve current HEAD' })
        .getAttribute('aria-disabled'),
      'true'
    )
  })

  it('exposes loading, empty, unavailable, partial, and operation states', () => {
    let refreshes = 0
    const view = render(
      <MergeRequestLifecycleActions {...props({ kind: 'loading' })} />
    )
    assert.ok(screen.getByText('Loading the merge-request lifecycle…'))
    assert.strictEqual(
      verification(view.container, 'merge-request-lifecycle')?.dataset.state,
      'loading'
    )

    view.rerender(
      <MergeRequestLifecycleActions
        {...props({ kind: 'empty' }, { onRefresh: () => (refreshes += 1) })}
      />
    )
    fireEvent.click(screen.getByRole('button', { name: 'Refresh lifecycle' }))

    view.rerender(
      <MergeRequestLifecycleActions
        {...props(
          { kind: 'unavailable' },
          { onRefresh: () => (refreshes += 1) }
        )}
      />
    )
    assert.ok(screen.getByRole('alert'))
    fireEvent.click(screen.getByRole('button', { name: 'Refresh lifecycle' }))
    assert.strictEqual(refreshes, 2)

    view.rerender(
      <MergeRequestLifecycleActions
        {...props(
          {
            kind: 'partial',
            summary: summary(),
            unavailable: ['approval', 'pipeline', 'readiness'],
          },
          { operation: { kind: 'running', action: 'refresh' } }
        )}
      />
    )
    assert.ok(verification(view.container, 'merge-request-lifecycle-partial'))
    assert.ok(screen.getByText('Approval state is unavailable.'))
    assert.ok(screen.getByText('Pipeline state is unavailable.'))
    assert.strictEqual(
      verification(view.container, 'merge-request-lifecycle')?.getAttribute(
        'aria-busy'
      ),
      'true'
    )
    assert.ok(verification(view.container, 'merge-request-lifecycle-operation'))
  })

  it('localizes lifecycle labels live', async () => {
    render(<MergeRequestLifecycleActions {...props()} />)
    document.dispatchEvent(
      new CustomEvent(LanguageModeChangedEvent, { detail: 'cantonese' })
    )
    await waitFor(() =>
      assert.ok(screen.getByRole('heading', { name: 'Merge request 生命週期' }))
    )
    assert.ok(screen.getByText('開放 · 草稿'))
    assert.ok(screen.getByText('覆核者要求咗修改', { exact: false }))
    assert.ok(screen.getByRole('button', { name: '批准目前 HEAD' }))
  })
})
