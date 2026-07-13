import assert from 'node:assert'
import { execFile } from 'node:child_process'
import { createHash } from 'node:crypto'
import {
  createServer,
  IncomingMessage,
  request as httpRequest,
  ServerResponse,
} from 'node:http'
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { promisify } from 'node:util'
import { describe, it } from 'node:test'
import { API, fetchUser } from '../../src/lib/api'
import { parseWorkflowDispatchInputs } from '../../src/lib/actions-workflow-inputs'
import {
  createGuidedProofChildEnvironment,
  createGuidedProofHandler,
  createGuidedProofRepository,
  GuidedProofRequestHandler,
  IGuidedProofHandlerFixture,
} from '../../../script/guided-proof-fixture'

const execFileAsync = promisify(execFile)
const tokenA = 'synthetic-guided-proof-token-a'
const tokenB = 'synthetic-guided-proof-token-b'

interface IProofHarness {
  readonly fixture: IGuidedProofHandlerFixture
  readonly root: string
  readonly fixtureRoot: string
  readonly origin: string
  readonly endpoint: string
  close(): Promise<void>
}

function basicAuthorization(token: string): string {
  return `Basic ${Buffer.from(`x-access-token:${token}`, 'utf8').toString(
    'base64'
  )}`
}

async function listen(
  handler: (request: IncomingMessage, response: ServerResponse) => void
): Promise<{
  readonly server: ReturnType<typeof createServer>
  readonly origin: string
}> {
  const server = createServer(handler)
  await new Promise<void>((resolvePromise, reject) => {
    server.once('error', reject)
    server.listen(0, '127.0.0.1', () => resolvePromise())
  })
  const address = server.address()
  if (address === null || typeof address === 'string') {
    throw new Error('The proof test server did not expose a loopback port.')
  }
  return { server, origin: `http://127.0.0.1:${address.port}` }
}

async function createHarness(): Promise<IProofHarness> {
  const root = await mkdtemp(join(tmpdir(), 'desktop-material-proof-test-'))
  const fixtureRoot = join(root, 'owned-fixture')
  const repository = await createGuidedProofRepository(fixtureRoot)
  let handler: GuidedProofRequestHandler | null = null
  const running = await listen((request, response) => {
    if (handler === null) {
      response.destroy()
      return
    }
    handler(request, response)
  })
  const originURL = new URL(`${running.origin}/`)
  const fixture = createGuidedProofHandler({
    repository,
    origin: originURL.toString(),
    expectedHost: originURL.host,
    tokenA,
    tokenB,
  })
  handler = fixture.handler
  return {
    fixture,
    root,
    fixtureRoot,
    origin: running.origin,
    endpoint: `${running.origin}/api/v3`,
    close: async () => {
      await fixture.stopUploadPacks()
      await new Promise<void>(resolvePromise =>
        running.server.close(() => resolvePromise())
      )
      await fixture.waitForRequests()
      await fixture.flushLedger()
      const safeRoot = resolve(root)
      assert.ok(safeRoot.startsWith(resolve(tmpdir())))
      await rm(safeRoot, { recursive: true })
    },
  }
}

async function runGitClone(
  cloneURL: string,
  destination: string,
  token: string
): Promise<void> {
  const configPath = `${destination}.proof.gitconfig`
  await writeFile(
    configPath,
    `[credential]\n\thelper =\n[http]\n\textraHeader = Authorization: ${basicAuthorization(
      token
    )}\n`,
    { encoding: 'utf8', flag: 'wx', mode: 0o600 }
  )
  try {
    const environment = createGuidedProofChildEnvironment(process.env)
    environment.GIT_CONFIG_GLOBAL = configPath
    await execFileAsync('git', ['clone', '--quiet', cloneURL, destination], {
      env: environment,
      windowsHide: true,
    })
  } finally {
    await rm(configPath, { force: true })
  }
}

async function requestWithDeclaredLength(
  url: string,
  length: number
): Promise<number> {
  return await new Promise<number>((resolvePromise, reject) => {
    const parsed = new URL(url)
    const request = httpRequest(
      {
        hostname: parsed.hostname,
        port: parsed.port,
        path: parsed.pathname,
        method: 'POST',
        headers: {
          Authorization: `Bearer ${tokenB}`,
          'Content-Length': String(length),
          'Content-Type': 'application/json',
        },
      },
      response => {
        response.resume()
        response.once('end', () => resolvePromise(response.statusCode ?? 0))
      }
    )
    request.once('error', reject)
    request.end()
  })
}

async function proofMutation(
  url: string,
  value: unknown,
  contentType: string = 'application/json'
): Promise<Response> {
  return await fetch(url, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${tokenB}`,
      'Content-Type': contentType,
    },
    body:
      contentType === 'application/json' ? JSON.stringify(value) : `${value}`,
  })
}

describe('guided hidden-desktop proof fixture', () => {
  it('creates the same verified three-commit bare repository in empty owned roots', async () => {
    const root = await mkdtemp(join(tmpdir(), 'desktop-material-proof-repo-'))
    try {
      const first = await createGuidedProofRepository(join(root, 'first'))
      const second = await createGuidedProofRepository(join(root, 'second'))
      assert.equal(first.commitCount, 3)
      assert.equal(second.commitCount, 3)
      assert.equal(first.headSha, second.headSha)
      assert.equal(first.headSha, 'e602b6bae7af1dbcd62a4434b6bf4d24bc46c234')
      const { stdout: isBare } = await execFileAsync(
        'git',
        [
          '--git-dir',
          first.bareRepositoryPath,
          'config',
          '--bool',
          'core.bare',
        ],
        { windowsHide: true }
      )
      assert.equal(isBare.trim(), 'true')
      const { stdout: identities } = await execFileAsync(
        'git',
        [
          '--git-dir',
          first.bareRepositoryPath,
          'log',
          '--format=%an%x00%ae%x00%cn%x00%ce',
        ],
        { windowsHide: true }
      )
      const expectedIdentity =
        'Guided Proof\u0000guided-proof@example.invalid\u0000Guided Proof\u0000guided-proof@example.invalid'
      assert.deepEqual(identities.trim().split(/\r?\n/), [
        expectedIdentity,
        expectedIdentity,
        expectedIdentity,
      ])

      const occupied = join(root, 'occupied')
      await mkdir(occupied)
      await writeFile(join(occupied, 'caller-data.txt'), 'preserve\n')
      await assert.rejects(
        createGuidedProofRepository(occupied),
        /must be empty/
      )
      assert.equal(
        await readFile(join(occupied, 'caller-data.txt'), 'utf8'),
        'preserve\n'
      )
    } finally {
      const safeRoot = resolve(root)
      assert.ok(safeRoot.startsWith(resolve(tmpdir())))
      await rm(safeRoot, { recursive: true })
    }
  })

  it('serves production parser contracts and a real account-B smart-Git clone', async () => {
    const harness = await createHarness()
    try {
      const accountAResponse = await fetch(`${harness.endpoint}/user`, {
        headers: { Authorization: `Bearer ${tokenA}` },
      })
      assert.equal(accountAResponse.status, 200)
      assert.equal((await accountAResponse.json()).login, 'proof-a')

      const api = new API(harness.endpoint, tokenB)
      assert.equal((await api.fetchAccount()).login, 'proof-b')
      const signedIn = await fetchUser(harness.endpoint, tokenB)
      assert.equal(signedIn.login, 'proof-b')
      assert.equal(signedIn.id, 102)
      const publicAvatar = await fetch(
        `${harness.endpoint}/enterprise/avatars/proof-b`
      )
      assert.equal(publicAvatar.status, 200)
      assert.match(publicAvatar.headers.get('content-type') ?? '', /image\/svg/)
      assert.match(await publicAvatar.text(), />B<\/text>/)
      assert.deepEqual(await api.fetchFeatureFlags(), [])
      const repository = await api.fetchRepository(
        'material-proof',
        'guided-proof'
      )
      assert.equal(repository?.clone_url, harness.fixture.ready.cloneUrl)

      const issues = await api.fetchIssuePage(
        'material-proof',
        'guided-proof',
        {
          state: 'open',
          search: '',
          labels: [],
          assignee: null,
          milestone: null,
          sort: 'updated',
          direction: 'desc',
          page: 1,
        }
      )
      assert.equal(issues.issues[0].number, 7)
      assert.equal(
        (await api.fetchIssueMetadata('material-proof', 'guided-proof')).labels
          .length,
        2
      )
      assert.equal(
        (await api.fetchIssueCommentPage('material-proof', 'guided-proof', 7))
          .comments.length,
        1
      )

      const releases = await api.fetchReleases('material-proof', 'guided-proof')
      assert.equal(releases.releases[0].name, 'Guided proof release')
      assert.equal(
        (await api.fetchReleaseAssets('material-proof', 'guided-proof', 4201))
          .assets[0].name,
        'guided-proof.txt'
      )

      assert.equal(
        (await api.fetchWorkflows('material-proof', 'guided-proof'))
          .workflows[0].name,
        'Guided proof CI'
      )
      assert.equal(
        (await api.fetchWorkflowRuns('material-proof', 'guided-proof'))
          .workflow_runs[0].conclusion,
        'success'
      )
      assert.equal(
        (await api.fetchWorkflowRunJobs('material-proof', 'guided-proof', 7001))
          ?.jobs[0].name,
        'Windows x64'
      )
      const artifact = (
        await api.fetchWorkflowRunArtifacts(
          'material-proof',
          'guided-proof',
          7001
        )
      ).artifacts[0]
      assert.equal(artifact.name, 'guided-proof-artifact')
      assert.equal(
        await api.fetchArtifactAttestationPresence(
          'material-proof',
          'guided-proof',
          artifact.digest!
        ),
        true
      )
      const artifactDownload = await fetch(
        `${harness.endpoint}/repos/material-proof/guided-proof/actions/artifacts/7301/zip`,
        { headers: { Authorization: `Bearer ${tokenB}` } }
      )
      assert.equal(artifactDownload.status, 200)
      const artifactBytes = Buffer.from(await artifactDownload.arrayBuffer())
      assert.equal(artifactBytes.length, artifact.sizeInBytes)
      assert.equal(
        `sha256:${createHash('sha256').update(artifactBytes).digest('hex')}`,
        artifact.digest
      )
      const jobLog = await fetch(
        `${harness.endpoint}/repos/material-proof/guided-proof/actions/jobs/7101/logs`,
        { headers: { Authorization: `Bearer ${tokenB}` } }
      )
      assert.equal(jobLog.status, 200)
      assert.match(await jobLog.text(), /Guided proof build completed/)
      assert.equal(
        (
          await api.fetchEffectiveBranchRules(
            'material-proof',
            'guided-proof',
            'main'
          )
        ).rules.length,
        2
      )
      await api.setWorkflowEnabled('material-proof', 'guided-proof', 700, false)
      assert.equal(
        (await api.fetchWorkflows('material-proof', 'guided-proof'))
          .workflows[0].state,
        'disabled_manually'
      )
      const workflowSource = await api.fetchWorkflowFileContent(
        'material-proof',
        'guided-proof',
        '.github/workflows/guided-proof.yml',
        'main'
      )
      const workflowDispatch = parseWorkflowDispatchInputs(workflowSource)
      assert.equal(workflowDispatch.available, true)
      assert.equal(workflowDispatch.inputs[0].name, 'proof_scope')
      await api.dispatchWorkflow(
        'material-proof',
        'guided-proof',
        700,
        'main',
        { proof_scope: 'guided' }
      )
      await api.setWorkflowEnabled('material-proof', 'guided-proof', 700, true)

      const initialPullRequest = await api.inspectPullRequest(
        'material-proof',
        'guided-proof',
        8
      )
      assert.equal(
        initialPullRequest.headSHA,
        harness.fixture.ready.repository.headSha
      )
      const updatedPullRequest = await api.updatePullRequestLifecycle(
        'material-proof',
        'guided-proof',
        8,
        initialPullRequest.headSHA,
        {
          title: 'Finish the bounded guided proof review',
          body: 'Reviewed through the production lifecycle parser.',
          base: 'main',
          metadata: {
            reviewers: ['proof-a'],
            assignees: ['proof-b'],
            labels: ['material-proof'],
          },
        }
      )
      assert.equal(updatedPullRequest.warnings.length, 0)
      assert.deepEqual(updatedPullRequest.pullRequest.metadata.reviewers, [
        'proof-a',
      ])
      const reviewReceipt = await api.submitPullRequestReview(
        'material-proof',
        'guided-proof',
        8,
        initialPullRequest.headSHA,
        { event: 'COMMENT', body: 'Bounded review submitted.' }
      )
      assert.equal(reviewReceipt.state, 'COMMENTED')

      const createdPullRequest = await api.createPullRequest(
        'material-proof',
        'guided-proof',
        'Compose a second guided proof',
        'Created through the production pull request parser.',
        'proof-compose',
        'main',
        false,
        { name: null, fullName: 'material-proof/guided-proof' },
        undefined,
        {
          reviewers: ['guided-proof-reviewer'],
          assignees: ['proof-b'],
          labels: ['guided-proof'],
        }
      )
      assert.equal(createdPullRequest.number, 9)
      assert.equal(createdPullRequest.metadataWarnings, undefined)
      assert.deepEqual(
        (
          await api.inspectPullRequest(
            'material-proof',
            'guided-proof',
            createdPullRequest.number
          )
        ).metadata.labels,
        ['guided-proof']
      )
      for (const state of ['closed', 'open'] as const) {
        const stateResponse = await fetch(
          `${harness.endpoint}/repos/material-proof/guided-proof/pulls/9`,
          {
            method: 'PATCH',
            headers: {
              Authorization: `Bearer ${tokenB}`,
              'Content-Type': 'application/json',
            },
            body: JSON.stringify({ state }),
          }
        )
        assert.equal(stateResponse.status, 200)
        assert.equal((await stateResponse.json()).state, state)
        assert.equal(
          (
            await api.inspectPullRequest(
              'material-proof',
              'guided-proof',
              createdPullRequest.number
            )
          ).state,
          state
        )
      }
      const mergeReceipt = await api.mergePullRequest(
        'material-proof',
        'guided-proof',
        8,
        initialPullRequest.headSHA,
        'squash'
      )
      assert.equal(mergeReceipt.merged, true)
      assert.equal(mergeReceipt.sha, initialPullRequest.headSHA)

      const triageIssues = await api.fetchProviderTriageIssues(
        'material-proof',
        'guided-proof',
        50
      )
      const triagePullRequests = await api.fetchProviderTriagePullRequests(
        'material-proof',
        'guided-proof',
        50
      )
      assert.equal(triageIssues.supported, true)
      assert.equal(triageIssues.items[0].number, 7)
      assert.equal(triagePullRequests.supported, true)
      assert.equal(triagePullRequests.items[0].number, 9)

      const triage = await fetch(
        `${harness.endpoint}/repos/material-proof/guided-proof/pulls?state=open&sort=updated&direction=desc&page=1&per_page=50`,
        { headers: { Authorization: `Bearer ${tokenB}` } }
      )
      assert.equal(triage.status, 200)
      assert.equal((await triage.json())[0].number, 9)

      const accountAClone = await fetch(
        `${harness.fixture.ready.cloneUrl}/info/refs?service=git-upload-pack`,
        { headers: { Authorization: basicAuthorization(tokenA) } }
      )
      assert.equal(accountAClone.status, 404)
      const cloneDestination = join(harness.root, 'clone')
      await runGitClone(
        harness.fixture.ready.cloneUrl,
        cloneDestination,
        tokenB
      )
      const { stdout: cloneCount } = await execFileAsync(
        'git',
        ['rev-list', '--count', 'HEAD'],
        { cwd: cloneDestination, windowsHide: true }
      )
      assert.equal(cloneCount.trim(), '3')

      await harness.fixture.flushLedger()
      const ledger = await readFile(
        join(harness.fixtureRoot, harness.fixture.ready.ledger.path),
        'utf8'
      )
      assert.match(ledger, /"account":"proof-a"/)
      assert.match(ledger, /"account":"proof-b"/)
      assert.doesNotMatch(ledger, new RegExp(tokenA))
      assert.doesNotMatch(ledger, new RegExp(tokenB))
      const readyJSON = JSON.stringify(harness.fixture.ready)
      assert.doesNotMatch(readyJSON, new RegExp(tokenA))
      assert.doesNotMatch(readyJSON, new RegExp(tokenB))
      assert.doesNotMatch(readyJSON, /"pid"/i)
      assert.doesNotMatch(readyJSON, /"[A-Za-z]:[\\/]|\\Users\\/i)
    } finally {
      await harness.close()
    }
  })

  it('filters and paginates search while bounding every mutable collection', async () => {
    const harness = await createHarness()
    const repositoryPath = `${harness.endpoint}/repos/material-proof/guided-proof`
    try {
      const oversizedIssue = await proofMutation(`${repositoryPath}/issues`, {
        title: 'Rejected oversized issue',
        body: 'x'.repeat(65_537),
      })
      assert.equal(oversizedIssue.status, 400)

      for (let index = 0; index < 19; index++) {
        const response = await proofMutation(`${repositoryPath}/issues`, {
          title: `Synthetic bounded issue ${index}`,
          body: `Deterministic filler ${index}`,
        })
        assert.equal(response.status, 201)
      }
      assert.equal(
        (
          await proofMutation(`${repositoryPath}/issues`, {
            title: 'Beyond issue limit',
            body: '',
          })
        ).status,
        409
      )

      const api = new API(harness.endpoint, tokenB)
      const filtered = await api.fetchIssuePage(
        'material-proof',
        'guided-proof',
        {
          state: 'open',
          search: 'hidden desktop',
          labels: ['guided-proof'],
          assignee: null,
          milestone: null,
          sort: 'updated',
          direction: 'desc',
          page: 1,
        }
      )
      assert.deepEqual(
        filtered.issues.map(issue => issue.number),
        [7]
      )

      const searchParameters = new URLSearchParams({
        q: 'repo:material-proof/guided-proof is:issue state:open in:title,body "Synthetic bounded"',
        per_page: '3',
        page: '2',
        sort: 'updated',
        order: 'asc',
      })
      const secondPage = await fetch(
        `${harness.endpoint}/search/issues?${searchParameters.toString()}`,
        { headers: { Authorization: `Bearer ${tokenB}` } }
      )
      assert.equal(secondPage.status, 200)
      assert.ok(
        Number(secondPage.headers.get('content-length')) < 2 * 1024 * 1024
      )
      const searchPage = (await secondPage.json()) as {
        readonly total_count: number
        readonly items: ReadonlyArray<{ readonly number: number }>
      }
      assert.equal(searchPage.total_count, 19)
      assert.equal(searchPage.items.length, 3)
      assert.ok(searchPage.items.every(issue => issue.number !== 7))

      const unsupportedSearch = new URLSearchParams({
        q: 'repo:material-proof/guided-proof is:issue author:proof-b',
      })
      assert.equal(
        (
          await fetch(
            `${harness.endpoint}/search/issues?${unsupportedSearch.toString()}`,
            { headers: { Authorization: `Bearer ${tokenB}` } }
          )
        ).status,
        400
      )

      for (let index = 0; index < 19; index++) {
        const response = await proofMutation(
          `${repositoryPath}/issues/7/comments`,
          { body: `Bounded comment ${index}` }
        )
        assert.equal(response.status, 201)
      }
      assert.equal(
        (
          await proofMutation(`${repositoryPath}/issues/7/comments`, {
            body: 'Beyond comment limit',
          })
        ).status,
        409
      )

      for (let index = 0; index < 9; index++) {
        const response = await proofMutation(`${repositoryPath}/releases`, {
          tag_name: `bounded-release-${index}`,
          target_commitish: 'main',
          name: `Bounded release ${index}`,
          body: '',
          draft: true,
          prerelease: false,
        })
        assert.equal(response.status, 201)
      }
      assert.equal(
        (
          await proofMutation(`${repositoryPath}/releases`, {
            tag_name: 'beyond-release-limit',
            target_commitish: 'main',
            name: 'Beyond release limit',
            body: '',
            draft: true,
            prerelease: false,
          })
        ).status,
        409
      )

      for (let index = 0; index < 19; index++) {
        const response = await proofMutation(
          `${harness.origin}/api/uploads/repos/material-proof/guided-proof/releases/4201/assets?name=bounded-${index}.txt`,
          'x',
          'text/plain'
        )
        assert.equal(response.status, 201)
      }
      assert.equal(
        (
          await proofMutation(
            `${harness.origin}/api/uploads/repos/material-proof/guided-proof/releases/4201/assets?name=beyond-limit.txt`,
            'x',
            'text/plain'
          )
        ).status,
        409
      )
    } finally {
      await harness.close()
    }
  })

  it('fails closed on unknown auth, routes, methods, queries, and oversized bodies', async () => {
    const harness = await createHarness()
    try {
      const unknownAccount = await fetch(`${harness.endpoint}/user`, {
        headers: { Authorization: 'Bearer unknown-proof-token' },
      })
      assert.equal(unknownAccount.status, 401)

      const unknownRoute = await fetch(`${harness.endpoint}/unexpected`, {
        headers: { Authorization: `Bearer ${tokenB}` },
      })
      assert.equal(unknownRoute.status, 404)

      const wrongMethod = await fetch(
        `${harness.endpoint}/repos/material-proof/guided-proof`,
        {
          method: 'DELETE',
          headers: { Authorization: `Bearer ${tokenB}` },
        }
      )
      assert.equal(wrongMethod.status, 405)

      const injectedQuery = await fetch(
        `${harness.endpoint}/repos/material-proof/guided-proof/releases?per_page=30&page=1&next=https://example.invalid`,
        { headers: { Authorization: `Bearer ${tokenB}` } }
      )
      assert.equal(injectedQuery.status, 400)

      assert.equal(
        await requestWithDeclaredLength(
          `${harness.endpoint}/repos/material-proof/guided-proof/issues`,
          2 * 1024 * 1024 + 1
        ),
        413
      )

      await harness.fixture.flushLedger()
      const ledgerLines = (
        await readFile(
          join(harness.fixtureRoot, harness.fixture.ready.ledger.path),
          'utf8'
        )
      )
        .trim()
        .split('\n')
        .map(line => JSON.parse(line) as Record<string, unknown>)
      assert.ok(ledgerLines.length >= 5)
      for (const entry of ledgerLines) {
        assert.deepEqual(Object.keys(entry), [
          'sequence',
          'method',
          'route',
          'account',
          'status',
        ])
      }
    } finally {
      await harness.close()
    }
  })
})
