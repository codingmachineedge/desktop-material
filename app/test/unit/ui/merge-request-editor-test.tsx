import assert from 'node:assert'
import { describe, it } from 'node:test'
import * as React from 'react'
import { LanguageModeChangedEvent } from '../../../src/lib/i18n'
import {
  MergeRequestEditor,
  type IMergeRequestEditorProps,
} from '../../../src/ui/merge-request/merge-request-editor'
import type {
  IMergeRequestEditorContext,
  IMergeRequestEditorSubmission,
  IMergeRequestRouteIdentity,
  MergeRequestEditorAvailability,
} from '../../../src/ui/merge-request/merge-request-model'
import { fireEvent, render, screen, waitFor } from '../../helpers/ui/render'

function route(
  accountKey = 'gitlab:https://gitlab.example:test-user'
): IMergeRequestRouteIdentity {
  return {
    repositoryId: 'repository-1',
    accountKey,
    accountDisplayName: 'Test User',
    friendlyEndpoint: 'gitlab.example',
    projectPath: 'desktop/material',
  }
}

function context(
  overrides: Partial<IMergeRequestEditorContext> = {}
): IMergeRequestEditorContext {
  return {
    version: 'context-1',
    route: route(),
    sourceBranches: [{ name: 'feature' }, { name: 'feature-next' }],
    targetBranches: [{ name: 'main' }, { name: 'release' }],
    reviewers: [
      { id: '11', displayName: 'Reviewer One', username: 'reviewer-one' },
      { id: '12', displayName: 'Reviewer Two' },
    ],
    assignees: [{ id: '21', displayName: 'Assignee One' }],
    headSha: 'a'.repeat(40),
    ...overrides,
  }
}

function props(
  availability: MergeRequestEditorAvailability = {
    kind: 'ready',
    context: context(),
  },
  overrides: Partial<IMergeRequestEditorProps> = {}
): IMergeRequestEditorProps {
  return {
    mode: 'create',
    route: route(),
    availability,
    initialValue: {
      sourceBranch: 'feature',
      targetBranch: 'main',
      title: 'Draft: Ship the GitLab editor',
      body: 'Ready for a bounded review.',
      reviewerIds: ['11'],
      assigneeIds: ['21'],
    },
    onSubmit: () => {},
    onRefresh: () => {},
    onCancel: () => {},
    ...overrides,
  }
}

function verification(
  container: HTMLElement,
  value: string
): HTMLElement | null {
  return container.querySelector(`[data-verification="${value}"]`)
}

function selectMultiple(select: HTMLSelectElement, values: string[]) {
  for (const option of Array.from(select.options)) {
    option.selected = values.includes(option.value)
  }
  fireEvent.change(select)
}

describe('MergeRequestEditor', () => {
  it('renders exact repository routing, stable hooks, legacy draft state, and an exact submission', () => {
    const submissions: IMergeRequestEditorSubmission[] = []
    const view = render(
      <MergeRequestEditor
        {...props(undefined, {
          onSubmit: submission => submissions.push(submission),
        })}
      />
    )

    assert.ok(screen.getByRole('heading', { name: 'Create merge request' }))
    assert.ok(screen.getByText('desktop/material'))
    assert.ok(screen.getByText('Test User'))
    assert.ok(screen.getByText('gitlab.example'))
    assert.strictEqual(
      screen.queryByRole('combobox', { name: /account/i }),
      null
    )
    for (const hook of [
      'merge-request-editor',
      'merge-request-route',
      'merge-request-form',
      'merge-request-source',
      'merge-request-target',
      'merge-request-title',
      'merge-request-body',
      'merge-request-draft',
      'merge-request-reviewers',
      'merge-request-assignees',
      'merge-request-cancel',
      'merge-request-submit',
    ]) {
      assert.ok(verification(view.container, hook), `missing ${hook}`)
    }
    assert.strictEqual(
      (screen.getByLabelText('Draft merge request') as HTMLInputElement)
        .checked,
      true
    )
    assert.strictEqual(
      (screen.getByLabelText('Title') as HTMLInputElement).value,
      'Ship the GitLab editor'
    )

    fireEvent.change(screen.getByLabelText('Source branch'), {
      target: { value: 'feature-next' },
    })
    fireEvent.change(screen.getByLabelText('Target branch'), {
      target: { value: 'release' },
    })
    fireEvent.change(screen.getByLabelText('Title'), {
      target: { value: '  Ship the safe editor  ' },
    })
    fireEvent.change(screen.getByLabelText('Description (optional)'), {
      target: { value: 'Reviewed description' },
    })
    fireEvent.click(screen.getByLabelText('Draft merge request'))
    selectMultiple(screen.getByLabelText('Reviewers') as HTMLSelectElement, [
      '12',
    ])
    selectMultiple(screen.getByLabelText('Assignees') as HTMLSelectElement, [])
    fireEvent.click(
      screen.getByRole('button', { name: 'Create merge request' })
    )

    assert.deepStrictEqual(submissions, [
      {
        route: route(),
        contextVersion: 'context-1',
        headSha: 'a'.repeat(40),
        sourceBranch: 'feature-next',
        targetBranch: 'release',
        title: 'Ship the safe editor',
        body: 'Reviewed description',
        draft: false,
        reviewerIds: ['12'],
        assigneeIds: [],
      },
    ])
  })

  it('blocks invalid required fields and links errors to their controls', () => {
    let submissions = 0
    const sharedContext = context({
      sourceBranches: [{ name: 'feature' }, { name: 'main' }],
    })
    render(
      <MergeRequestEditor
        {...props(
          { kind: 'ready', context: sharedContext },
          {
            initialValue: {
              sourceBranch: 'main',
              targetBranch: 'main',
              title: '',
            },
            onSubmit: () => {
              submissions += 1
            },
          }
        )}
      />
    )

    fireEvent.click(
      screen.getByRole('button', { name: 'Create merge request' })
    )

    assert.strictEqual(submissions, 0)
    assert.ok(screen.getByRole('alert'))
    assert.ok(screen.getByText('Source and target branches must be different.'))
    assert.ok(screen.getByText('Enter a merge-request title.'))
    assert.strictEqual(
      screen.getByLabelText('Title').getAttribute('aria-invalid'),
      'true'
    )
    assert.strictEqual(
      screen.getByLabelText('Source branch').getAttribute('aria-invalid'),
      'true'
    )
    assert.ok(verification(document.body, 'merge-request-validation'))
  })

  it('keeps the source branch immutable in edit mode', () => {
    const submissions: IMergeRequestEditorSubmission[] = []
    render(
      <MergeRequestEditor
        {...props(undefined, {
          mode: 'edit',
          onSubmit: submission => submissions.push(submission),
        })}
      />
    )

    const source = screen.getByLabelText('Source branch') as HTMLSelectElement
    assert.strictEqual(source.disabled, true)
    assert.ok(
      screen.getByText(
        'GitLab does not support changing the source branch after creation.'
      )
    )
    fireEvent.change(source, { target: { value: 'feature-next' } })
    fireEvent.click(screen.getByRole('button', { name: 'Save merge request' }))

    assert.strictEqual(submissions.length, 1)
    assert.strictEqual(submissions[0].sourceBranch, 'feature')
  })

  it('links unsupported title and body characters to both controls', () => {
    render(
      <MergeRequestEditor
        {...props(undefined, {
          initialValue: {
            sourceBranch: 'feature',
            targetBranch: 'main',
            title: 'Unsafe\0title',
            body: 'Unsafe\0description',
          },
        })}
      />
    )

    fireEvent.click(
      screen.getByRole('button', { name: 'Create merge request' })
    )

    const title = screen.getByLabelText('Title')
    const body = screen.getByLabelText('Description (optional)')
    assert.strictEqual(title.getAttribute('aria-invalid'), 'true')
    assert.strictEqual(body.getAttribute('aria-invalid'), 'true')
    assert.match(title.getAttribute('aria-describedby') ?? '', /validation/)
    assert.match(body.getAttribute('aria-describedby') ?? '', /validation/)
    assert.ok(
      screen.getByText(
        'Remove surrounding whitespace or unsupported control characters from the title.'
      )
    )
    assert.ok(
      screen.getByText(
        'The description contains an unsupported null character.'
      )
    )
  })

  it('renders loading, empty, and bounded error states with refresh', () => {
    let refreshes = 0
    const view = render(
      <MergeRequestEditor
        {...props({ kind: 'loading' }, { onRefresh: () => (refreshes += 1) })}
      />
    )

    assert.ok(screen.getByText('Loading bounded merge-request choices…'))
    assert.strictEqual(
      verification(view.container, 'merge-request-editor')?.dataset.state,
      'loading'
    )

    view.rerender(
      <MergeRequestEditor
        {...props(
          { kind: 'empty', reason: 'no-target-branches' },
          { onRefresh: () => (refreshes += 1) }
        )}
      />
    )
    assert.ok(screen.getByText('No target branches are available.'))
    fireEvent.click(
      screen.getByRole('button', { name: 'Refresh merge-request context' })
    )

    view.rerender(
      <MergeRequestEditor
        {...props(
          { kind: 'error', reason: 'authentication' },
          { onRefresh: () => (refreshes += 1) }
        )}
      />
    )
    assert.ok(
      screen.getByText(
        'The repository-bound GitLab account could not be authenticated.'
      )
    )
    fireEvent.click(
      screen.getByRole('button', { name: 'Refresh merge-request context' })
    )
    assert.strictEqual(refreshes, 2)
    assert.strictEqual(
      screen.queryByText(/token|response body|PRIVATE-TOKEN/i),
      null
    )
  })

  it('keeps required fields usable when optional identity choices are partial', () => {
    const view = render(
      <MergeRequestEditor
        {...props({
          kind: 'partial',
          context: context(),
          unavailable: ['reviewers'],
          capped: ['assignees'],
        })}
      />
    )

    assert.ok(screen.getByText('Some optional choices are incomplete'))
    assert.ok(verification(view.container, 'merge-request-partial'))
    assert.strictEqual(
      (screen.getByLabelText('Reviewers') as HTMLSelectElement).disabled,
      true
    )
    assert.strictEqual(
      (screen.getByLabelText('Assignees') as HTMLSelectElement).disabled,
      false
    )
    assert.strictEqual(
      (screen.getByLabelText('Title') as HTMLInputElement).disabled,
      false
    )
  })

  it('invalidates an older context when repository account identity changes', async () => {
    let submissions = 0
    const view = render(
      <MergeRequestEditor
        {...props(undefined, {
          onSubmit: () => (submissions += 1),
        })}
      />
    )
    fireEvent.change(screen.getByLabelText('Title'), {
      target: { value: 'Unsaved old-route title' },
    })

    const nextRoute = route('gitlab:https://gitlab.example:other-user')
    view.rerender(
      <MergeRequestEditor
        {...props(undefined, {
          route: nextRoute,
          onSubmit: () => (submissions += 1),
        })}
      />
    )

    assert.ok(screen.getByText('Repository or account context changed'))
    assert.ok(verification(view.container, 'merge-request-stale'))
    assert.strictEqual(
      verification(view.container, 'merge-request-editor')?.dataset.state,
      'stale'
    )
    assert.strictEqual(
      screen
        .getByRole('button', { name: 'Create merge request' })
        .getAttribute('aria-disabled'),
      'true'
    )
    assert.strictEqual(submissions, 0)

    const nextContext = context({
      version: 'context-2',
      route: nextRoute,
    })
    view.rerender(
      <MergeRequestEditor
        {...props(
          { kind: 'ready', context: nextContext },
          {
            route: nextRoute,
            initialValue: {
              sourceBranch: 'feature',
              targetBranch: 'main',
              title: 'Fresh account context',
            },
          }
        )}
      />
    )
    await waitFor(() =>
      assert.strictEqual(
        (screen.getByLabelText('Title') as HTMLInputElement).value,
        'Fresh account context'
      )
    )
    assert.strictEqual(
      verification(view.container, 'merge-request-editor')?.dataset.state,
      'ready'
    )
  })

  it('renders transient and blocked detailed merge readiness without overclaiming', () => {
    const view = render(
      <MergeRequestEditor
        {...props(
          {
            kind: 'ready',
            context: context({ detailedMergeStatus: 'checking' }),
          },
          { mode: 'edit' }
        )}
      />
    )

    assert.ok(screen.getByText('GitLab is still checking merge readiness…'))
    assert.strictEqual(
      verification(view.container, 'merge-request-readiness')?.dataset.status,
      'transient'
    )

    view.rerender(
      <MergeRequestEditor
        {...props(
          {
            kind: 'ready',
            context: context({ detailedMergeStatus: 'approvals_syncing' }),
          },
          { mode: 'edit' }
        )}
      />
    )
    assert.ok(screen.getByText('GitLab is still checking merge readiness…'))

    view.rerender(
      <MergeRequestEditor
        {...props(
          {
            kind: 'ready',
            context: context({ detailedMergeStatus: 'not_approved' }),
          },
          { mode: 'edit' }
        )}
      />
    )
    assert.ok(screen.getByText('Blocked: required approvals are missing'))
    assert.strictEqual(
      verification(view.container, 'merge-request-readiness')?.dataset.status,
      'blocked'
    )
  })

  it('localizes live and exposes submitting, success, canceled, and failure states', async () => {
    const view = render(
      <MergeRequestEditor
        {...props(undefined, { operation: { kind: 'submitting' } })}
      />
    )
    assert.strictEqual(
      verification(view.container, 'merge-request-editor')?.getAttribute(
        'aria-busy'
      ),
      'true'
    )
    assert.ok(screen.getAllByText('Creating merge request…').length >= 1)

    document.dispatchEvent(
      new CustomEvent(LanguageModeChangedEvent, { detail: 'cantonese' })
    )
    await waitFor(() =>
      assert.ok(screen.getByRole('heading', { name: '建立 merge request' }))
    )
    assert.ok(screen.getAllByText('建立緊 merge request…').length >= 1)

    view.rerender(
      <MergeRequestEditor
        {...props(undefined, { operation: { kind: 'success' } })}
      />
    )
    assert.ok(screen.getByText('Merge request 已建立。'))

    view.rerender(
      <MergeRequestEditor
        {...props(undefined, { operation: { kind: 'canceled' } })}
      />
    )
    assert.ok(screen.getByText('Merge request 操作已取消。'))

    view.rerender(
      <MergeRequestEditor
        {...props(undefined, {
          operation: { kind: 'error', reason: 'stale' },
        })}
      />
    )
    assert.ok(
      screen.getByText(
        '更新完成之前，repo、帳戶、merge request 或 HEAD 已經轉咗。'
      )
    )
  })
})
