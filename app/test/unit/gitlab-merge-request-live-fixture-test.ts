import assert from 'node:assert'
import { describe, it } from 'node:test'
import { GitLabAPI } from '../../src/lib/api'
import { GitLabMergeRequestContextChangedError } from '../../src/lib/gitlab-merge-request'

const endpointVariable = 'DESKTOP_MATERIAL_GITLAB_MR_LIVE_ENDPOINT'
const projectVariable = 'DESKTOP_MATERIAL_GITLAB_MR_LIVE_PROJECT'
const endpoint = process.env[endpointVariable]
const project = process.env[projectVariable]
const fixtureEnabled = endpoint !== undefined && project !== undefined
const fixtureToken = 'desktop-material-gitlab-token'

function liveEndpoint(): string {
  assert.ok(
    endpoint,
    `${endpointVariable} is required by the live fixture runner`
  )
  const parsed = new URL(endpoint)
  assert.equal(parsed.protocol, 'http:')
  assert.equal(parsed.hostname, '127.0.0.1')
  assert.equal(parsed.pathname, '/')
  assert.equal(parsed.username, '')
  assert.equal(parsed.password, '')
  assert.equal(parsed.search, '')
  assert.equal(parsed.hash, '')
  return parsed.origin
}

function liveProject(): string {
  assert.ok(
    project,
    `${projectVariable} is required by the live fixture runner`
  )
  assert.equal(project, 'material-labs/platform/desktop-material')
  return project
}

async function fixtureRequest<T>(
  path: string,
  options?: RequestInit
): Promise<T> {
  const response = await fetch(`${liveEndpoint()}${path}`, {
    ...options,
    redirect: 'error',
    headers: {
      'Content-Type': 'application/json',
      ...options?.headers,
    },
  })
  assert.equal(response.ok, true, `fixture control ${path} failed`)
  return (await response.json()) as T
}

async function setFault(mode: 'none' | 'delayed'): Promise<void> {
  const state = await fixtureRequest<{ readonly faultMode: string }>(
    '/__fixture__/fault',
    {
      method: 'POST',
      body: JSON.stringify({ mode }),
    }
  )
  assert.equal(state.faultMode, mode)
}

async function waitForDelayedRequest(): Promise<void> {
  const deadline = Date.now() + 5_000
  while (Date.now() < deadline) {
    const state = await fixtureRequest<{
      readonly activeDelayedRequests: number
    }>('/__fixture__/state')
    if (state.activeDelayedRequests === 1) {
      return
    }
    await new Promise(resolve => setTimeout(resolve, 20))
  }
  assert.fail('live GitLab request did not enter the cancellation window')
}

describe(
  'GitLab merge request live fixture',
  {
    skip: fixtureEnabled
      ? false
      : `run through the owned fixture runner (${endpointVariable})`,
  },
  () => {
    it('drives the real GitLabAPI through the complete guarded lifecycle', async () => {
      const fixtureRoot = liveEndpoint()
      const projectPath = liveProject()
      await fixtureRequest('/__fixture__/reset', {
        method: 'POST',
        body: '{}',
      })
      const api = new GitLabAPI(fixtureRoot, fixtureToken)

      const listed = await api.listGitLabMergeRequests(projectPath, {
        state: 'all',
        orderBy: 'updated_at',
        sort: 'desc',
      })
      assert.equal(listed.capped, false)
      assert.deepEqual(
        listed.items.map(item => item.iid),
        [41, 40, 39, 38, 37]
      )
      assert.ok(
        listed.items.every(item => item.webUrl.startsWith(`${fixtureRoot}/`))
      )

      const members = await api.listGitLabProjectMembers(projectPath)
      assert.equal(members.capped, false)
      assert.deepEqual(
        members.items.map(member => member.id),
        [101, 102, 103, 104]
      )
      assert.ok(
        members.items.every(member =>
          member.webUrl.startsWith(`${fixtureRoot}/`)
        )
      )

      const created = await api.createGitLabMergeRequest(projectPath, {
        sourceBranch: 'feature/typescript-live-proof',
        targetBranch: 'main',
        title: 'TypeScript client lifecycle',
        description: 'Created through the production GitLabAPI client.',
        draft: true,
        reviewerIds: [101, 103],
        assigneeIds: [104],
      })
      assert.equal(created.iid, 42)
      assert.equal(created.draft, true)
      assert.equal(created.title, 'TypeScript client lifecycle')
      assert.deepEqual(
        created.reviewers.map(reviewer => reviewer.id),
        [101, 103]
      )
      assert.deepEqual(
        created.assignees.map(assignee => assignee.id),
        [104]
      )

      const edited = await api.updateGitLabMergeRequest(
        projectPath,
        created.iid,
        created.headSHA,
        created.updatedAt,
        {
          title: 'TypeScript client lifecycle ready',
          description: 'Edited through the production GitLabAPI client.',
          targetBranch: 'release/next',
          draft: false,
          reviewerIds: [103],
          assigneeIds: [101, 104],
        }
      )
      assert.equal(edited.title, 'TypeScript client lifecycle ready')
      assert.equal(
        edited.description,
        'Edited through the production GitLabAPI client.'
      )
      assert.equal(edited.targetBranch, 'release/next')
      assert.equal(edited.draft, false)
      assert.notEqual(edited.updatedAt, created.updatedAt)
      assert.deepEqual(
        edited.reviewers.map(reviewer => reviewer.id),
        [103]
      )
      assert.deepEqual(
        edited.assignees.map(assignee => assignee.id),
        [101, 104]
      )

      await assert.rejects(
        api.updateGitLabMergeRequest(
          projectPath,
          created.iid,
          created.headSHA,
          created.updatedAt,
          { title: 'A stale edit must not be dispatched' }
        ),
        GitLabMergeRequestContextChangedError
      )

      const wrongHead =
        edited.headSHA === 'f'.repeat(40) ? '0'.repeat(40) : 'f'.repeat(40)
      await assert.rejects(
        api.approveGitLabMergeRequest(projectPath, edited.iid, wrongHead),
        GitLabMergeRequestContextChangedError
      )
      const approved = await api.approveGitLabMergeRequest(
        projectPath,
        edited.iid,
        edited.headSHA
      )
      assert.equal(approved.approved, true)
      assert.equal(approved.approvalsLeft, 0)
      assert.deepEqual(
        approved.approvedBy.map(approval => approval.user.id),
        [101]
      )

      await assert.rejects(
        api.unapproveGitLabMergeRequest(projectPath, edited.iid, wrongHead),
        GitLabMergeRequestContextChangedError
      )
      const unapproved = await api.unapproveGitLabMergeRequest(
        projectPath,
        edited.iid,
        edited.headSHA
      )
      assert.equal(unapproved.approved, false)
      assert.equal(unapproved.approvalsLeft, 1)

      const closed = await api.setGitLabMergeRequestState(
        projectPath,
        edited.iid,
        edited.headSHA,
        edited.updatedAt,
        'close'
      )
      assert.equal(closed.state, 'closed')
      assert.notEqual(closed.updatedAt, edited.updatedAt)

      const reopened = await api.setGitLabMergeRequestState(
        projectPath,
        closed.iid,
        closed.headSHA,
        closed.updatedAt,
        'reopen'
      )
      assert.equal(reopened.state, 'opened')
      assert.notEqual(reopened.updatedAt, closed.updatedAt)

      await setFault('delayed')
      try {
        const controller = new AbortController()
        const canceled = assert.rejects(
          api.getGitLabMergeRequest(
            projectPath,
            reopened.iid,
            controller.signal
          ),
          (error: unknown) => (error as Error)?.name === 'AbortError'
        )
        await waitForDelayedRequest()
        controller.abort()
        await canceled
      } finally {
        await setFault('none')
      }
    })
  }
)
