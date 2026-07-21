import assert from 'node:assert'
import { afterEach, beforeEach, describe, it } from 'node:test'
import * as React from 'react'
import {
  IGitLabMergeRequest,
  IGitLabMergeRequestDraft,
  IGitLabMergeRequestUpdate,
} from '../../../src/lib/gitlab-merge-request'
import {
  IGitLabMergeRequestBranchContext,
  IGitLabMergeRequestWorkspaceRoute,
} from '../../../src/lib/gitlab-merge-request-workspace'
import { IGitLabMergeRequestMutationReview } from '../../../src/lib/stores/gitlab-merge-request-store'
import { GitHubRepository } from '../../../src/models/github-repository'
import { Owner } from '../../../src/models/owner'
import { Repository } from '../../../src/models/repository'
import {
  GitLabMergeRequestDialog,
  IGitLabMergeRequestDialogProps,
  IGitLabMergeRequestDialogService,
} from '../../../src/ui/merge-request/gitlab-merge-request-dialog'
import { fireEvent, render, screen, waitFor } from '../../helpers/ui/render'

let restoreIpcSend: (() => void) | null = null
let restoreDialogShow: (() => void) | null = null

beforeEach(async () => {
  localStorage.removeItem('appearance-customization-v1')
  const electron = await import('electron')
  const previousSend = electron.ipcRenderer.send
  electron.ipcRenderer.send = () => {}
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

const route: IGitLabMergeRequestWorkspaceRoute = {
  repositoryId: '7',
  accountKey: 'https://gitlab.example/api/v4#101',
  accountUserId: 101,
  accountLogin: 'ada',
  accountDisplayName: 'Ada Maintainer',
  friendlyEndpoint: 'GitLab · gitlab.example',
  providerHTMLURL: 'https://gitlab.example',
  projectPath: 'group/subgroup/material',
}

const branchContext: IGitLabMergeRequestBranchContext = {
  sourceBranch: 'feature-safe',
  targetBranches: ['main', 'release'],
  initialTargetBranch: 'main',
}

const hosted = new GitHubRepository(
  'material',
  new Owner('group/subgroup', 'https://gitlab.example/api/v4', 77),
  77
)
const repository = new Repository('C:\\work\\material', 7, hosted, false)

function user(id: number, username: string) {
  return {
    id,
    username,
    name: username.replace('-', ' '),
    avatarUrl: null,
    webUrl: `https://gitlab.example/${username}`,
  }
}

const snapshot: IGitLabMergeRequest = {
  id: 1042,
  iid: 42,
  projectId: 77,
  title: 'Existing review',
  description: 'Existing body',
  state: 'opened',
  draft: false,
  sourceBranch: 'feature-safe',
  targetBranch: 'main',
  sourceProjectId: 77,
  targetProjectId: 77,
  headSHA: 'a'.repeat(40),
  author: user(102, 'river-author'),
  assignees: [user(104, 'kai-assignee')],
  reviewers: [user(103, 'mina-reviewer')],
  webUrl: 'https://gitlab.example/group/subgroup/material/-/merge_requests/42',
  createdAt: '2026-07-19T10:00:00Z',
  updatedAt: '2026-07-20T10:00:00Z',
  mergedAt: null,
  closedAt: null,
  mergeWhenPipelineSucceeds: false,
  readiness: {
    kind: 'ready',
    status: 'mergeable',
    hasConflicts: false,
    blockingDiscussionsResolved: true,
  },
  approval: {
    approved: false,
    approvalsRequired: 1,
    approvalsLeft: 1,
    approvedBy: [],
  },
}

interface IServiceCalls {
  readonly creates: IGitLabMergeRequestDraft[]
  readonly updates: IGitLabMergeRequestUpdate[]
  readonly states: Array<'close' | 'reopen'>
  readonly openedURLs: string[]
  approvals: number
  refreshes: number
}

function service(
  calls: IServiceCalls,
  overrides: Partial<IGitLabMergeRequestDialogService> = {}
): IGitLabMergeRequestDialogService {
  return {
    availability: () => 'available',
    contextCurrent: () => true,
    listMembers: async () => ({
      items: [
        { ...user(103, 'mina-reviewer'), accessLevel: 30 },
        { ...user(104, 'kai-assignee'), accessLevel: 30 },
      ],
      capped: false,
    }),
    get: async () => ({
      ...snapshot,
      approval:
        calls.approvals > 0
          ? {
              approved: true,
              approvalsRequired: 1,
              approvalsLeft: 0,
              approvedBy: [{ user: user(101, 'ada'), approvedAt: null }],
            }
          : snapshot.approval,
    }),
    create: async (_repository, draft) => {
      calls.creates.push(draft)
      return {
        ...snapshot,
        title: draft.title,
        description: draft.description,
        draft: draft.draft,
        sourceBranch: draft.sourceBranch,
        targetBranch: draft.targetBranch,
        reviewers: draft.reviewerIds.map(id => user(id, `user-${id}`)),
        assignees: draft.assigneeIds.map(id => user(id, `user-${id}`)),
      }
    },
    createMutationReview: () =>
      ({ fixture: true } as unknown as IGitLabMergeRequestMutationReview),
    update: async (_repository, _review, update) => {
      calls.updates.push(update)
      return { ...snapshot, ...update }
    },
    setState: async (_repository, _review, state) => {
      calls.states.push(state)
      return {
        ...snapshot,
        state: state === 'close' ? 'closed' : 'opened',
      }
    },
    approve: async () => {
      calls.approvals++
      return {
        approved: true,
        approvalsRequired: 1,
        approvalsLeft: 0,
        approvedBy: [{ user: user(101, 'ada'), approvedAt: null }],
      }
    },
    unapprove: async () => {
      calls.approvals--
      return {
        approved: false,
        approvalsRequired: 1,
        approvalsLeft: 1,
        approvedBy: [],
      }
    },
    refreshPullRequests: async () => {
      calls.refreshes++
    },
    openInBrowser: async url => {
      calls.openedURLs.push(url)
    },
    ...overrides,
  }
}

function calls(): IServiceCalls {
  return {
    creates: [],
    updates: [],
    states: [],
    openedURLs: [],
    approvals: 0,
    refreshes: 0,
  }
}

function props(
  dialogService: IGitLabMergeRequestDialogService,
  overrides: Partial<IGitLabMergeRequestDialogProps> = {}
): IGitLabMergeRequestDialogProps {
  return {
    repository,
    route,
    branchContext,
    contextVersion: 'context-1',
    intent: { kind: 'create' },
    service: dialogService,
    onDismissed: () => {},
    ...overrides,
  }
}

function selectMultiple(select: HTMLSelectElement, values: string[]) {
  for (const option of Array.from(select.options)) {
    option.selected = values.includes(option.value)
  }
  fireEvent.change(select)
}

function deferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void
  const promise = new Promise<T>(resolver => {
    resolve = resolver
  })
  return { promise, resolve }
}

describe('GitLabMergeRequestDialog', () => {
  it('creates through the exact route and promotes the result into lifecycle edit mode', async () => {
    const observed = calls()
    render(<GitLabMergeRequestDialog {...props(service(observed))} />)

    await waitFor(() => {
      assert.ok(screen.getByLabelText('Title'))
    })
    assert.equal(
      (screen.getByLabelText('Title') as HTMLInputElement).value,
      'Feature safe'
    )
    fireEvent.change(screen.getByLabelText('Title'), {
      target: { value: 'Ship native GitLab review' },
    })
    fireEvent.change(screen.getByLabelText('Target branch'), {
      target: { value: 'release' },
    })
    selectMultiple(screen.getByLabelText('Reviewers') as HTMLSelectElement, [
      '103',
    ])
    fireEvent.click(
      screen.getByRole('button', { name: 'Create merge request' })
    )

    await waitFor(() => {
      assert.equal(observed.creates.length, 1)
      assert.ok(screen.getByText('Merge request lifecycle'))
    })
    assert.deepEqual(observed.creates[0], {
      sourceBranch: 'feature-safe',
      targetBranch: 'release',
      title: 'Ship native GitLab review',
      description: '',
      draft: false,
      reviewerIds: [103],
      assigneeIds: [],
    })
    assert.equal(observed.refreshes, 1)
    assert.equal(screen.getAllByText('Edit merge request').length, 2)
  })

  it('submits only dirty edit fields and wires state and approval actions', async () => {
    const observed = calls()
    render(
      <GitLabMergeRequestDialog
        {...props(service(observed), {
          intent: { kind: 'manage', mergeRequestIID: 42 },
        })}
      />
    )

    await waitFor(() => {
      assert.ok(screen.getByRole('button', { name: 'Save merge request' }))
    })
    assert.equal(
      (screen.getByLabelText('Source branch') as HTMLSelectElement).disabled,
      true
    )
    fireEvent.change(screen.getByLabelText('Title'), {
      target: { value: 'Only this field changed' },
    })
    fireEvent.click(screen.getByRole('button', { name: 'Save merge request' }))
    await waitFor(() => assert.equal(observed.updates.length, 1))
    assert.deepEqual(observed.updates[0], { title: 'Only this field changed' })

    fireEvent.click(
      screen.getByRole('button', { name: 'Approve current HEAD' })
    )
    await waitFor(() => {
      assert.equal(observed.approvals, 1)
      assert.ok(screen.getByRole('button', { name: 'Remove approval' }))
    })
    fireEvent.click(screen.getByRole('button', { name: 'Remove approval' }))
    await waitFor(() => assert.equal(observed.approvals, 0))

    fireEvent.click(screen.getByRole('button', { name: 'Close merge request' }))
    await waitFor(() => assert.deepEqual(observed.states, ['close']))
    assert.equal(observed.refreshes, 4)
  })

  it('fails stale before transport and keeps optional member failures partial', async () => {
    const observed = calls()
    let current = true
    render(
      <GitLabMergeRequestDialog
        {...props(
          service(observed, {
            contextCurrent: () => current,
            listMembers: async () => {
              throw new Error('optional member channel unavailable')
            },
          })
        )}
      />
    )
    await waitFor(() => {
      assert.ok(screen.getByText('Some optional choices are incomplete'))
    })
    current = false
    fireEvent.change(screen.getByLabelText('Title'), {
      target: { value: 'Must not submit' },
    })
    fireEvent.click(
      screen.getByRole('button', { name: 'Create merge request' })
    )
    await waitFor(() => {
      assert.ok(screen.getByText('Repository or account context changed'))
    })
    assert.equal(observed.creates.length, 0)
  })

  it('invalidates destructive lifecycle actions when an authoritative refresh fails', async () => {
    const observed = calls()
    let gets = 0
    render(
      <GitLabMergeRequestDialog
        {...props(
          service(observed, {
            get: async () => {
              gets++
              if (gets > 1) {
                throw new Error('authoritative refresh unavailable')
              }
              return snapshot
            },
          }),
          { intent: { kind: 'manage', mergeRequestIID: 42 } }
        )}
      />
    )

    assert.ok(
      screen.getByRole('heading', { level: 1, name: 'Edit merge request' })
    )
    await waitFor(() => {
      assert.ok(screen.getByRole('button', { name: 'Close merge request' }))
    })
    fireEvent.click(screen.getByRole('button', { name: 'Refresh lifecycle' }))
    await waitFor(() => {
      assert.ok(screen.getByText('Merge-request lifecycle is unavailable'))
    })
    assert.equal(
      screen.queryByRole('button', { name: 'Close merge request' }),
      null
    )
    assert.deepEqual(observed.states, [])
    assert.equal(observed.approvals, 0)
  })

  it('globally gates competing mutations while a transport is in flight', async () => {
    const observed = calls()
    const update = deferred<IGitLabMergeRequest>()
    render(
      <GitLabMergeRequestDialog
        {...props(
          service(observed, {
            update: async (_repository, _review, value) => {
              observed.updates.push(value)
              return update.promise
            },
          }),
          { intent: { kind: 'manage', mergeRequestIID: 42 } }
        )}
      />
    )

    await waitFor(() => {
      assert.ok(screen.getByRole('button', { name: 'Save merge request' }))
    })
    fireEvent.change(screen.getByLabelText('Title'), {
      target: { value: 'Delayed update' },
    })
    fireEvent.click(screen.getByRole('button', { name: 'Save merge request' }))
    await waitFor(() => assert.equal(observed.updates.length, 1))
    const close = screen.getByRole<HTMLButtonElement>('button', {
      name: 'Close merge request',
    })
    assert.equal(close.matches(':disabled'), true)
    close.click()
    assert.deepEqual(observed.states, [])

    update.resolve({ ...snapshot, title: 'Delayed update' })
    await waitFor(() => assert.equal(observed.refreshes, 1))
    assert.deepEqual(observed.states, [])
  })

  it('rejects a mutation result when repository or account context changes in flight', async () => {
    const observed = calls()
    const creation = deferred<IGitLabMergeRequest>()
    let current = true
    render(
      <GitLabMergeRequestDialog
        {...props(
          service(observed, {
            contextCurrent: () => current,
            create: async (_repository, draft) => {
              observed.creates.push(draft)
              return creation.promise
            },
          })
        )}
      />
    )

    await waitFor(() => assert.ok(screen.getByLabelText('Title')))
    fireEvent.change(screen.getByLabelText('Title'), {
      target: { value: 'Context-bound result' },
    })
    fireEvent.click(
      screen.getByRole('button', { name: 'Create merge request' })
    )
    await waitFor(() => assert.equal(observed.creates.length, 1))
    current = false
    creation.resolve({ ...snapshot, title: 'Context-bound result' })

    await waitFor(() => {
      assert.ok(screen.getByText('Repository or account context changed'))
    })
    assert.equal(observed.refreshes, 0)
    assert.equal(screen.queryByText('Merge request lifecycle'), null)
  })

  it('opens only the exact canonical project URL and rechecks context at click time', async () => {
    const observed = calls()
    let current = true
    render(
      <GitLabMergeRequestDialog
        {...props(
          service(observed, {
            contextCurrent: () => current,
            get: async () => ({
              ...snapshot,
              webUrl:
                'https://gitlab.example/other/project/-/merge_requests/999',
            }),
          }),
          { intent: { kind: 'manage', mergeRequestIID: 42 } }
        )}
      />
    )

    await waitFor(() => {
      assert.ok(screen.getByRole('button', { name: 'Open on GitLab' }))
    })
    fireEvent.click(screen.getByRole('button', { name: 'Open on GitLab' }))
    await waitFor(() => assert.equal(observed.openedURLs.length, 1))
    assert.deepEqual(observed.openedURLs, [
      'https://gitlab.example/group/subgroup/material/-/merge_requests/42',
    ])

    current = false
    fireEvent.click(screen.getByRole('button', { name: 'Open on GitLab' }))
    await waitFor(() => {
      assert.ok(screen.getByText('Merge-request lifecycle context changed'))
    })
    assert.equal(observed.openedURLs.length, 1)
  })
})
