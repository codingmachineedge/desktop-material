import {
  ChildProcess,
  ChildProcessWithoutNullStreams,
  spawn,
} from 'child_process'
import { createHash } from 'crypto'
import { IncomingMessage, ServerResponse } from 'http'
import { createServer as createHTTPSServer, Server as HTTPSServer } from 'https'
import {
  appendFile,
  lstat,
  mkdir,
  open,
  readdir,
  rm,
  writeFile,
} from 'fs/promises'
import { dirname, isAbsolute, join, parse, resolve } from 'path'

const ProofOwner = 'material-proof'
const ProofRepository = 'guided-proof'
const ProofBranch = 'main'
const ProofBindAddress = '127.0.0.1'
const ProofAPIPrefix = '/api/v3'
const ProofGitPath = `/${ProofOwner}/${ProofRepository}.git`
const ProofRequestBodyMaximumBytes = 2 * 1024 * 1024
const ProofResponseBodyMaximumBytes = 2 * 1024 * 1024
const ProofTLSFileMaximumBytes = 1024 * 1024
const ProofChildOutputMaximumBytes = 16 * 1024 * 1024
const ProofGitResponseMaximumBytes = ProofChildOutputMaximumBytes + 1024
const ProofChildMaximumRuntimeMilliseconds = 30_000
const ProofChildShutdownGraceMilliseconds = 2_000
const ProofDate = '2026-07-13T12:00:00Z'
const ProofEarlierDate = '2026-06-01T09:00:00Z'
const ProofGitName = 'Guided Proof'
const ProofGitEmail = 'guided-proof@example.invalid'
const ProofExpectedHeadSha = 'e602b6bae7af1dbcd62a4434b6bf4d24bc46c234'
const ProofIssueBodyMaximumLength = 65_536
const ProofIssueMaximumCount = 20
const ProofIssueCommentMaximumCount = 20
const ProofPullRequestMaximumCount = 5
const ProofPullRequestReviewMaximumCount = 10
const ProofReleaseMaximumCount = 10
const ProofReleaseAssetMaximumCount = 20
const ProofReleaseAssetStoredMaximumBytes = 16 * 1024 * 1024
const ProofArtifactBytes = Buffer.from(
  'UEsFBgAAAAAAAAAAAAAAAAAAAAAAAA==',
  'base64'
)
const ProofReleaseBytes = Buffer.from('Desktop Material guided proof asset\n')
const ProofWorkflowYAML = [
  'name: Guided proof CI',
  'on:',
  '  workflow_dispatch:',
  '    inputs:',
  '      proof_scope:',
  '        description: Bounded proof scope',
  '        required: true',
  '        type: choice',
  '        default: guided',
  '        options:',
  '          - guided',
  '          - complete',
  'jobs:',
  '  proof:',
  '    runs-on: windows-latest',
  '    steps:',
  '      - run: echo guided-proof',
  '',
].join('\n')

const activeGuidedProofGitChildren = new Set<ChildProcess>()

type ProofAccountClass = 'proof-a' | 'proof-b' | 'anonymous' | 'unknown'

interface IProofRepositoryResult {
  readonly root: string
  readonly bareRepositoryPath: string
  readonly headSha: string
  readonly commitCount: number
  readonly ledgerPath: string
  readonly readyPath: string
}

export interface IGuidedProofReady {
  readonly schemaVersion: 1
  readonly state: 'ready'
  readonly origin: string
  readonly endpoint: string
  readonly cloneUrl: string
  readonly repository: {
    readonly owner: typeof ProofOwner
    readonly name: typeof ProofRepository
    readonly defaultBranch: typeof ProofBranch
    readonly path: string
    readonly headSha: string
    readonly commitCount: number
  }
  readonly ledger: {
    readonly path: string
    readonly redaction: 'account-class-only'
  }
  readonly accountHints: ReadonlyArray<'proof-a' | 'proof-b'>
  readonly gitAuthentication: {
    readonly proofA: 'rejected'
    readonly proofB: 'accepted'
  }
}

export interface IGuidedProofContextOptions {
  readonly repository: IProofRepositoryResult
  readonly origin: string
  readonly expectedHost: string
  readonly tokenA: string
  readonly tokenB: string
}

interface IProofIdentity {
  readonly id: number
  readonly login: string
  readonly avatar_url: string
  readonly html_url: string
  readonly name: string
  readonly email: string
  readonly type: 'User'
  readonly plan: { readonly name: 'guided-proof' }
}

interface IProofLabel {
  readonly id: number
  readonly name: string
  readonly color: string
  readonly description: string
}

interface IProofMilestone {
  readonly number: number
  readonly title: string
  readonly state: 'open' | 'closed'
  readonly due_on: string | null
}

interface IProofIssue {
  id: number
  number: number
  title: string
  body: string
  state: 'open' | 'closed'
  state_reason: 'completed' | 'not_planned' | 'reopened' | null
  user: { login: string }
  created_at: string
  updated_at: string
  closed_at: string | null
  html_url: string
  labels: IProofLabel[]
  assignees: Array<{ login: string }>
  milestone: IProofMilestone | null
  comments: number
  locked: boolean
}

interface IProofComment {
  readonly id: number
  readonly body: string
  readonly user: { readonly login: string }
  readonly created_at: string
  readonly updated_at: string
  readonly html_url: string
}

interface IProofPullRequest {
  readonly id: number
  readonly number: number
  title: string
  body: string
  headRef: string
  headLabel: string
  headRepository: string
  base: string
  draft: boolean
  state: 'open' | 'closed'
  merged: boolean
  mergeable: boolean
  reviewers: string[]
  assignees: string[]
  labels: string[]
}

interface IProofPullRequestReview {
  readonly id: number
  readonly pullRequestNumber: number
  readonly state: 'APPROVED' | 'CHANGES_REQUESTED' | 'COMMENTED'
  readonly body: string
}

interface IProofReleaseAsset {
  readonly id: number
  readonly name: string
  readonly label: string | null
  readonly state: 'uploaded'
  readonly content_type: string
  readonly size: number
  readonly download_count: number
  readonly created_at: string
  readonly updated_at: string
  readonly digest: string
  readonly bytes: Buffer
}

interface IProofRelease {
  id: number
  tag_name: string
  target_commitish: string
  name: string
  body: string
  draft: boolean
  prerelease: boolean
  created_at: string
  published_at: string | null
  author: { readonly login: string }
  assets: IProofReleaseAsset[]
}

interface IProofAudit {
  route: string
  account: ProofAccountClass
}

class ProofPayloadTooLargeError extends Error {
  public constructor() {
    super('The guided proof request exceeded its fixed body limit.')
    this.name = 'ProofPayloadTooLargeError'
  }
}

class ProofRequestError extends Error {
  public constructor(
    public readonly status: number,
    public readonly code: string
  ) {
    super(code)
    this.name = 'ProofRequestError'
  }
}

function sha256(bytes: Uint8Array): string {
  return `sha256:${createHash('sha256').update(bytes).digest('hex')}`
}

function validateToken(value: string, label: string): string {
  if (
    typeof value !== 'string' ||
    value.length === 0 ||
    value.length > 4096 ||
    /[\u0000-\u001f\u007f]/.test(value)
  ) {
    throw new Error(
      `${label} must be non-empty text without control characters.`
    )
  }
  return value
}

const guidedProofChildEnvironmentAllowlist = new Set([
  'lang',
  'lc_all',
  'lc_ctype',
  'path',
  'pathext',
  'systemroot',
  'temp',
  'tmp',
  'tmpdir',
  'windir',
])

const guidedProofChildOverrideAllowlist = new Set([
  'git_author_date',
  'git_committer_date',
  'git_protocol',
])

function validateGuidedProofChildOverride(name: string, value: string): void {
  const normalizedName = name.toLowerCase()
  if (!guidedProofChildOverrideAllowlist.has(normalizedName)) {
    throw new Error(
      'Only fixed guided proof Git metadata may enter a child environment.'
    )
  }
  if (
    normalizedName === 'git_protocol'
      ? value !== 'version=2'
      : !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/.test(value)
  ) {
    throw new Error('The guided proof child environment override is invalid.')
  }
}

/** Keep all caller credentials out of every Git/upload-pack child environment. */
export function createGuidedProofChildEnvironment(
  base: NodeJS.ProcessEnv = process.env,
  overrides: Readonly<Record<string, string>> = {}
): NodeJS.ProcessEnv {
  const result: NodeJS.ProcessEnv = {}
  for (const [name, value] of Object.entries(base)) {
    if (guidedProofChildEnvironmentAllowlist.has(name.toLowerCase())) {
      result[name] = value
    }
  }
  for (const [name, value] of Object.entries(overrides)) {
    validateGuidedProofChildOverride(name, value)
    result[name] = value
  }
  result.GIT_CONFIG_NOSYSTEM = '1'
  result.GIT_CONFIG_GLOBAL = process.platform === 'win32' ? 'NUL' : '/dev/null'
  result.GIT_TERMINAL_PROMPT = '0'
  return result
}

function ensureChildPath(root: string, child: string): string {
  const normalizedRoot = `${resolve(root)}${
    process.platform === 'win32' ? '\\' : '/'
  }`
  const normalizedChild = resolve(child)
  const comparisonRoot =
    process.platform === 'win32' ? normalizedRoot.toLowerCase() : normalizedRoot
  const comparisonChild =
    process.platform === 'win32'
      ? normalizedChild.toLowerCase()
      : normalizedChild
  if (!comparisonChild.startsWith(comparisonRoot)) {
    throw new Error('The guided proof path escaped its caller-owned root.')
  }
  return normalizedChild
}

async function runGit(
  args: ReadonlyArray<string>,
  cwd: string,
  environment: Readonly<Record<string, string>> = {}
): Promise<Buffer> {
  return await new Promise<Buffer>((resolvePromise, reject) => {
    const child = spawn('git', args, {
      cwd,
      env: createGuidedProofChildEnvironment(process.env, environment),
      shell: false,
      windowsHide: true,
      stdio: ['ignore', 'pipe', 'pipe'],
    })
    activeGuidedProofGitChildren.add(child)
    const stdout = new Array<Buffer>()
    let stdoutBytes = 0
    let stderrBytes = 0
    let settled = false
    let terminationReason: string | null = null
    let escalation: NodeJS.Timeout | null = null
    const terminate = (message: string) => {
      if (settled || terminationReason !== null) {
        return
      }
      terminationReason = message
      child.kill()
      escalation = setTimeout(
        () => child.kill('SIGKILL'),
        ProofChildShutdownGraceMilliseconds
      )
    }
    const timeout = setTimeout(() => {
      terminate('A deterministic guided proof Git command timed out.')
    }, ProofChildMaximumRuntimeMilliseconds)
    const fail = (message: string) => {
      if (settled) {
        return
      }
      settled = true
      clearTimeout(timeout)
      if (escalation !== null) {
        clearTimeout(escalation)
      }
      reject(new Error(message))
    }
    child.stdout.on('data', (chunk: Buffer) => {
      stdoutBytes += chunk.length
      if (stdoutBytes > ProofChildOutputMaximumBytes) {
        terminate(
          'A deterministic guided proof Git command returned too much output.'
        )
        return
      }
      stdout.push(chunk)
    })
    child.stderr.on('data', (chunk: Buffer) => {
      stderrBytes += chunk.length
      if (stderrBytes > ProofChildOutputMaximumBytes) {
        terminate(
          'A deterministic guided proof Git command returned too much output.'
        )
      }
    })
    child.once('error', () => {
      if (terminationReason === null) {
        terminationReason = 'Unable to start Git.'
      }
    })
    child.once('close', code => {
      activeGuidedProofGitChildren.delete(child)
      if (settled) {
        return
      }
      if (terminationReason !== null) {
        fail(terminationReason)
        return
      }
      if (
        code !== 0 ||
        stdoutBytes > ProofChildOutputMaximumBytes ||
        stderrBytes > ProofChildOutputMaximumBytes
      ) {
        fail('A deterministic guided proof Git command failed.')
        return
      }
      settled = true
      clearTimeout(timeout)
      resolvePromise(Buffer.concat(stdout))
    })
  })
}

async function writeSeedFile(
  root: string,
  relativePath: string,
  contents: string
): Promise<void> {
  const destination = ensureChildPath(root, join(root, relativePath))
  await mkdir(dirname(destination), { recursive: true })
  await writeFile(destination, contents, { encoding: 'utf8', flag: 'wx' })
}

/**
 * Create a deterministic three-commit bare repository in an empty,
 * caller-owned root. The function never removes or overwrites a pre-existing
 * entry in that root.
 */
export async function createGuidedProofRepository(
  requestedRoot: string
): Promise<IProofRepositoryResult> {
  if (!isAbsolute(requestedRoot)) {
    throw new Error('The guided proof root must be an absolute path.')
  }
  const root = resolve(requestedRoot)
  if (root === parse(root).root) {
    throw new Error('The guided proof root cannot be a filesystem root.')
  }
  await mkdir(root, { recursive: true })
  const rootStat = await lstat(root)
  if (!rootStat.isDirectory() || rootStat.isSymbolicLink()) {
    throw new Error('The guided proof root must be a real directory.')
  }
  if ((await readdir(root)).length !== 0) {
    throw new Error('The guided proof root must be empty.')
  }

  const markerPath = ensureChildPath(
    root,
    join(root, '.guided-proof-owner.json')
  )
  const seedPath = ensureChildPath(root, join(root, 'seed'))
  const bareRepositoryPath = ensureChildPath(
    root,
    join(root, `${ProofRepository}.git`)
  )
  const ledgerPath = ensureChildPath(root, join(root, 'events.ndjson'))
  const readyPath = ensureChildPath(root, join(root, 'ready.json'))
  await writeFile(
    markerPath,
    `${JSON.stringify({ schemaVersion: 1, fixture: 'guided-proof' })}\n`,
    { encoding: 'utf8', flag: 'wx' }
  )
  await mkdir(seedPath)
  await runGit(['init', '-b', ProofBranch, '.'], seedPath)
  await runGit(['config', 'user.name', ProofGitName], seedPath)
  await runGit(['config', 'user.email', ProofGitEmail], seedPath)
  await runGit(['config', 'core.autocrlf', 'false'], seedPath)
  await runGit(['config', 'commit.gpgsign', 'false'], seedPath)

  const commits = [
    {
      date: '2026-07-11T09:00:00Z',
      message: 'Initial guided proof repository',
      path: 'README.md',
      contents:
        '# Guided Proof\n\nA deterministic repository for hidden-desktop verification.\n',
    },
    {
      date: '2026-07-12T10:00:00Z',
      message: 'Add proof workflow notes',
      path: 'proof/workflow.txt',
      contents: 'Build\nTest\nReview\n',
    },
    {
      date: '2026-07-13T11:00:00Z',
      message: 'Complete proof material',
      path: 'proof/status.txt',
      contents: 'ready\n',
    },
  ] as const

  for (const commit of commits) {
    await writeSeedFile(seedPath, commit.path, commit.contents)
    await runGit(['add', '--', commit.path], seedPath)
    await runGit(['commit', '-m', commit.message], seedPath, {
      GIT_AUTHOR_DATE: commit.date,
      GIT_COMMITTER_DATE: commit.date,
    })
  }

  await mkdir(bareRepositoryPath)
  await runGit(['init', '--bare', '.'], bareRepositoryPath)
  await runGit(['remote', 'add', 'proof', bareRepositoryPath], seedPath)
  await runGit(['push', 'proof', `${ProofBranch}:${ProofBranch}`], seedPath)
  await runGit(
    ['symbolic-ref', 'HEAD', `refs/heads/${ProofBranch}`],
    bareRepositoryPath
  )
  const headSha = (
    await runGit(['rev-parse', `refs/heads/${ProofBranch}`], bareRepositoryPath)
  )
    .toString('utf8')
    .trim()
  const commitCount = Number.parseInt(
    (
      await runGit(
        ['rev-list', '--count', `refs/heads/${ProofBranch}`],
        bareRepositoryPath
      )
    )
      .toString('utf8')
      .trim(),
    10
  )
  if (headSha !== ProofExpectedHeadSha || commitCount !== commits.length) {
    throw new Error(
      'The guided proof repository did not verify after creation.'
    )
  }
  await rm(seedPath, { recursive: true })
  await writeFile(ledgerPath, '', { encoding: 'utf8', flag: 'wx' })
  return {
    root,
    bareRepositoryPath,
    headSha,
    commitCount,
    ledgerPath,
    readyPath,
  }
}

class GuidedProofContext {
  public readonly ready: IGuidedProofReady
  public readonly activeUploadPacks = new Set<ChildProcessWithoutNullStreams>()
  public readonly labels: IProofLabel[]
  public readonly milestones: IProofMilestone[]
  public readonly assignees = ['proof-b', 'guided-proof-reviewer']
  public readonly issues: IProofIssue[]
  public readonly comments = new Map<number, IProofComment[]>()
  public readonly releases: IProofRelease[]
  public readonly pullRequests: IProofPullRequest[]
  public readonly pullRequestReviews: IProofPullRequestReview[] = []
  public workflowEnabled = true
  private sequence = 0
  private ledgerWrites: Promise<void> = Promise.resolve()
  private readonly activeRequests = new Set<Promise<void>>()

  public constructor(public readonly options: IGuidedProofContextOptions) {
    const origin = new URL(options.origin)
    if (
      (origin.protocol !== 'https:' && origin.protocol !== 'http:') ||
      origin.username !== '' ||
      origin.password !== '' ||
      origin.pathname !== '/' ||
      origin.search !== '' ||
      origin.hash !== '' ||
      origin.host.toLowerCase() !== options.expectedHost.toLowerCase()
    ) {
      throw new Error(
        'The guided proof origin must match the exact expected host.'
      )
    }
    validateToken(options.tokenA, 'Proof account A token')
    validateToken(options.tokenB, 'Proof account B token')
    if (options.tokenA === options.tokenB) {
      throw new Error('The two guided proof tokens must be distinct.')
    }
    const endpoint = new URL(`${ProofAPIPrefix}/`, origin)
      .toString()
      .replace(/\/$/, '')
    const cloneUrl = new URL(ProofGitPath, origin).toString()
    this.ready = {
      schemaVersion: 1,
      state: 'ready',
      origin: origin.toString().replace(/\/$/, ''),
      endpoint,
      cloneUrl,
      repository: {
        owner: ProofOwner,
        name: ProofRepository,
        defaultBranch: ProofBranch,
        path: `${ProofRepository}.git`,
        headSha: options.repository.headSha,
        commitCount: options.repository.commitCount,
      },
      ledger: {
        path: 'events.ndjson',
        redaction: 'account-class-only',
      },
      accountHints: ['proof-a', 'proof-b'],
      gitAuthentication: { proofA: 'rejected', proofB: 'accepted' },
    }
    this.labels = [
      {
        id: 1001,
        name: 'guided-proof',
        color: '0969da',
        description: 'Deterministic verification work',
      },
      {
        id: 1002,
        name: 'material-proof',
        color: '8250df',
        description: 'Material UI review',
      },
    ]
    this.milestones = [
      {
        number: 3,
        title: 'Guided proof milestone',
        state: 'open',
        due_on: null,
      },
    ]
    this.issues = [
      {
        id: 7007,
        number: 7,
        title: 'Review the guided proof surfaces',
        body: 'Verify the bounded repository tools on the hidden desktop.',
        state: 'open',
        state_reason: null,
        user: { login: 'proof-a' },
        created_at: ProofEarlierDate,
        updated_at: ProofDate,
        closed_at: null,
        html_url: `${this.ready.origin}/${ProofOwner}/${ProofRepository}/issues/7`,
        labels: [...this.labels],
        assignees: [{ login: 'proof-b' }],
        milestone: this.milestones[0],
        comments: 1,
        locked: false,
      },
    ]
    this.comments.set(7, [
      {
        id: 7701,
        body: 'The fixture response is bounded and ready for review.',
        user: { login: 'guided-proof-reviewer' },
        created_at: ProofDate,
        updated_at: ProofDate,
        html_url: `${this.ready.origin}/${ProofOwner}/${ProofRepository}/issues/7#issuecomment-7701`,
      },
    ])
    this.pullRequests = [
      {
        id: 8008,
        number: 8,
        title: 'Finish the guided proof review',
        body: 'A bounded synthetic pull request.',
        headRef: 'proof-work',
        headLabel: `${ProofOwner}:proof-work`,
        headRepository: `${ProofOwner}/${ProofRepository}`,
        base: ProofBranch,
        draft: false,
        state: 'open',
        merged: false,
        mergeable: true,
        reviewers: ['guided-proof-reviewer'],
        assignees: ['proof-b'],
        labels: ['guided-proof'],
      },
    ]
    const releaseAsset: IProofReleaseAsset = {
      id: 1901,
      name: 'guided-proof.txt',
      label: 'Guided proof sample',
      state: 'uploaded',
      content_type: 'text/plain',
      size: ProofReleaseBytes.length,
      download_count: 0,
      created_at: ProofDate,
      updated_at: ProofDate,
      digest: sha256(ProofReleaseBytes),
      bytes: ProofReleaseBytes,
    }
    this.releases = [
      {
        id: 4201,
        tag_name: 'guided-proof-v1',
        target_commitish: ProofBranch,
        name: 'Guided proof release',
        body: 'A local-only release used for deterministic UI verification.',
        draft: false,
        prerelease: false,
        created_at: ProofDate,
        published_at: ProofDate,
        author: { login: 'proof-b' },
        assets: [releaseAsset],
      },
    ]
  }

  public identity(account: 'proof-a' | 'proof-b'): IProofIdentity {
    return {
      id: account === 'proof-a' ? 101 : 102,
      login: account,
      avatar_url: `${this.ready.endpoint}/enterprise/avatars/${account}`,
      html_url: `${this.ready.origin}/${account}`,
      name: account === 'proof-a' ? 'Proof Account A' : 'Proof Account B',
      email: `${account}@example.invalid`,
      type: 'User',
      plan: { name: 'guided-proof' },
    }
  }

  public classifyAuthorization(value: string | undefined): ProofAccountClass {
    if (value === undefined || value.length === 0) {
      return 'anonymous'
    }
    let candidate = ''
    const bearer = /^(?:Bearer|token)\s+(.+)$/i.exec(value)
    if (bearer !== null) {
      candidate = bearer[1]
    } else {
      const basic = /^Basic\s+([A-Za-z0-9+/]+=*)$/i.exec(value)
      if (basic === null) {
        return 'unknown'
      }
      try {
        const decoded = Buffer.from(basic[1], 'base64').toString('utf8')
        const separator = decoded.indexOf(':')
        const username =
          separator === -1 ? decoded : decoded.slice(0, separator)
        const password = separator === -1 ? '' : decoded.slice(separator + 1)
        if (
          username === this.options.tokenA ||
          password === this.options.tokenA
        ) {
          return 'proof-a'
        }
        if (
          username === this.options.tokenB ||
          password === this.options.tokenB
        ) {
          return 'proof-b'
        }
        return 'unknown'
      } catch {
        return 'unknown'
      }
    }
    if (candidate === this.options.tokenA) {
      return 'proof-a'
    }
    if (candidate === this.options.tokenB) {
      return 'proof-b'
    }
    return 'unknown'
  }

  public recordEvent(
    method: string,
    route: string,
    account: ProofAccountClass,
    status: number
  ): void {
    const event = {
      sequence: ++this.sequence,
      method,
      route,
      account,
      status,
    }
    this.ledgerWrites = this.ledgerWrites.then(async () => {
      await appendFile(
        this.options.repository.ledgerPath,
        `${JSON.stringify(event)}\n`,
        'utf8'
      )
    })
  }

  public async flushLedger(): Promise<void> {
    await this.ledgerWrites
  }

  public trackRequest(request: Promise<void>): void {
    this.activeRequests.add(request)
    void request.then(
      () => this.activeRequests.delete(request),
      () => this.activeRequests.delete(request)
    )
  }

  public async waitForRequests(): Promise<void> {
    while (this.activeRequests.size > 0) {
      await Promise.allSettled([...this.activeRequests])
    }
  }

  public async stopUploadPacks(): Promise<void> {
    const waitForExit = async (
      active: ReadonlyArray<ChildProcessWithoutNullStreams>
    ): Promise<boolean> => {
      const exits = Promise.all(
        active.map(
          child =>
            new Promise<void>(resolvePromise => {
              if (child.exitCode !== null || child.signalCode !== null) {
                resolvePromise()
                return
              }
              child.once('close', () => resolvePromise())
            })
        )
      ).then(() => true)
      let timeout: NodeJS.Timeout | null = null
      const expired = new Promise<false>(resolvePromise => {
        timeout = setTimeout(
          () => resolvePromise(false),
          ProofChildShutdownGraceMilliseconds
        )
      })
      const exited = await Promise.race([exits, expired])
      if (timeout !== null) {
        clearTimeout(timeout)
      }
      return exited
    }

    const active = [...this.activeUploadPacks]
    active.forEach(child => child.kill())
    if (await waitForExit(active)) {
      return
    }
    active
      .filter(child => child.exitCode === null && child.signalCode === null)
      .forEach(child => child.kill('SIGKILL'))
    if (!(await waitForExit(active))) {
      throw new Error('A guided proof upload-pack process did not stop.')
    }
  }
}

export type GuidedProofRequestHandler = (
  request: IncomingMessage,
  response: ServerResponse
) => void

function sendBytes(
  response: ServerResponse,
  status: number,
  contentType: string,
  body: Uint8Array,
  headers: Readonly<Record<string, string>> = {},
  maximumBytes: number = ProofResponseBodyMaximumBytes
): void {
  if (
    !Number.isSafeInteger(maximumBytes) ||
    maximumBytes < 1 ||
    body.byteLength > maximumBytes
  ) {
    throw new Error('The guided proof response exceeded its fixed body limit.')
  }
  response.writeHead(status, {
    'Cache-Control': 'no-store',
    'Content-Length': String(body.byteLength),
    'Content-Type': contentType,
    'X-Content-Type-Options': 'nosniff',
    ...headers,
  })
  response.end(body)
}

function sendJSON(
  response: ServerResponse,
  status: number,
  value: unknown,
  headers: Readonly<Record<string, string>> = {}
): void {
  sendBytes(
    response,
    status,
    'application/json; charset=utf-8',
    Buffer.from(`${JSON.stringify(value)}\n`, 'utf8'),
    headers
  )
}

function sendText(
  response: ServerResponse,
  status: number,
  value: string,
  headers: Readonly<Record<string, string>> = {}
): void {
  sendBytes(
    response,
    status,
    'text/plain; charset=utf-8',
    Buffer.from(value, 'utf8'),
    headers
  )
}

function sendNoContent(response: ServerResponse, status: number = 204): void {
  response.writeHead(status, {
    'Cache-Control': 'no-store',
    'Content-Length': '0',
    'X-Content-Type-Options': 'nosniff',
  })
  response.end()
}

function sendAuthenticationRequired(response: ServerResponse): void {
  sendJSON(
    response,
    401,
    { message: 'Authentication required for the guided proof fixture.' },
    { 'WWW-Authenticate': 'Basic realm="guided-proof"' }
  )
}

function sendMethodNotAllowed(
  response: ServerResponse,
  allowedMethods: ReadonlyArray<string>
): void {
  sendJSON(
    response,
    405,
    { message: 'Method not allowed by the guided proof fixture.' },
    { Allow: allowedMethods.join(', ') }
  )
}

function requireMethod(
  request: IncomingMessage,
  response: ServerResponse,
  allowedMethods: ReadonlyArray<string>
): boolean {
  if (!allowedMethods.includes(request.method ?? '')) {
    sendMethodNotAllowed(response, allowedMethods)
    return false
  }
  return true
}

function requireOnlyQuery(url: URL, allowedNames: ReadonlyArray<string>): void {
  const allowed = new Set(allowedNames)
  const seen = new Set<string>()
  for (const [name] of url.searchParams) {
    if (!allowed.has(name) || seen.has(name)) {
      throw new ProofRequestError(400, 'invalid-query')
    }
    seen.add(name)
  }
}

function boundedIntegerQuery(
  url: URL,
  name: string,
  minimum: number,
  maximum: number,
  fallback: number
): number {
  const value = url.searchParams.get(name)
  if (value === null) {
    return fallback
  }
  if (!/^[0-9]+$/.test(value)) {
    throw new ProofRequestError(400, 'invalid-query')
  }
  const parsedValue = Number.parseInt(value, 10)
  if (parsedValue < minimum || parsedValue > maximum) {
    throw new ProofRequestError(400, 'invalid-query')
  }
  return parsedValue
}

async function readBody(
  request: IncomingMessage,
  maximumBytes: number = ProofRequestBodyMaximumBytes
): Promise<Buffer> {
  const declaredLength = request.headers['content-length']
  if (declaredLength !== undefined) {
    if (!/^[0-9]+$/.test(declaredLength)) {
      throw new ProofRequestError(400, 'invalid-content-length')
    }
    if (Number.parseInt(declaredLength, 10) > maximumBytes) {
      throw new ProofPayloadTooLargeError()
    }
  }
  const chunks = new Array<Buffer>()
  let size = 0
  for await (const value of request) {
    const chunk = Buffer.isBuffer(value) ? value : Buffer.from(value)
    size += chunk.length
    if (size > maximumBytes) {
      request.destroy()
      throw new ProofPayloadTooLargeError()
    }
    chunks.push(chunk)
  }
  return Buffer.concat(chunks)
}

async function readJSONObject(
  request: IncomingMessage
): Promise<Record<string, unknown>> {
  const contentType = request.headers['content-type'] ?? ''
  if (!contentType.toLowerCase().startsWith('application/json')) {
    throw new ProofRequestError(415, 'unsupported-content-type')
  }
  const body = await readBody(request)
  let value: unknown
  try {
    value = JSON.parse(body.toString('utf8'))
  } catch {
    throw new ProofRequestError(400, 'invalid-json')
  }
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new ProofRequestError(400, 'invalid-json-shape')
  }
  return value as Record<string, unknown>
}

function requireOnlyFields(
  value: Readonly<Record<string, unknown>>,
  allowedFields: ReadonlyArray<string>
): void {
  const allowed = new Set(allowedFields)
  if (Object.keys(value).some(field => !allowed.has(field))) {
    throw new ProofRequestError(400, 'unexpected-field')
  }
}

function boundedString(
  value: unknown,
  maximumLength: number,
  allowEmpty: boolean = false
): string {
  if (
    typeof value !== 'string' ||
    value.length > maximumLength ||
    (!allowEmpty && value.length === 0) ||
    /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(value)
  ) {
    throw new ProofRequestError(400, 'invalid-field')
  }
  return value
}

function boundedGitReference(value: unknown): string {
  const reference = boundedString(value, 255)
  if (
    reference.trim() !== reference ||
    reference.startsWith('/') ||
    reference.endsWith('/') ||
    reference.endsWith('.') ||
    reference.includes('..') ||
    reference.includes('//') ||
    reference.includes('@{') ||
    /[\u0000-\u0020\u007f~^:?*\\[]/.test(reference)
  ) {
    throw new ProofRequestError(422, 'invalid-git-reference')
  }
  return reference
}

function safeDecodeURIComponent(value: string): string {
  try {
    return decodeURIComponent(value)
  } catch {
    throw new ProofRequestError(400, 'invalid-path-encoding')
  }
}

function validateRequestBodyEnvelope(request: IncomingMessage): void {
  const declaredLength = request.headers['content-length']
  let parsedLength = 0
  if (declaredLength !== undefined) {
    if (!/^[0-9]+$/.test(declaredLength)) {
      throw new ProofRequestError(400, 'invalid-content-length')
    }
    parsedLength = Number.parseInt(declaredLength, 10)
    if (parsedLength > ProofRequestBodyMaximumBytes) {
      throw new ProofPayloadTooLargeError()
    }
  }
  if (
    ['GET', 'HEAD'].includes(request.method ?? '') &&
    (parsedLength > 0 || request.headers['transfer-encoding'] !== undefined)
  ) {
    throw new ProofRequestError(400, 'unexpected-request-body')
  }
}

function serializeReleaseAsset(
  asset: IProofReleaseAsset
): Omit<IProofReleaseAsset, 'bytes'> {
  return {
    id: asset.id,
    name: asset.name,
    label: asset.label,
    state: asset.state,
    content_type: asset.content_type,
    size: asset.size,
    download_count: asset.download_count,
    created_at: asset.created_at,
    updated_at: asset.updated_at,
    digest: asset.digest,
  }
}

function serializeRelease(release: IProofRelease): unknown {
  return {
    ...release,
    assets: release.assets.map(serializeReleaseAsset),
  }
}

function repositoryPayload(context: GuidedProofContext): unknown {
  return {
    id: 5001,
    node_id: 'R_guided_proof',
    clone_url: context.ready.cloneUrl,
    ssh_url: `git@localhost:${ProofOwner}/${ProofRepository}.git`,
    html_url: `${context.ready.origin}/${ProofOwner}/${ProofRepository}`,
    name: ProofRepository,
    full_name: `${ProofOwner}/${ProofRepository}`,
    owner: {
      id: 500,
      login: ProofOwner,
      avatar_url: `${context.ready.endpoint}/enterprise/avatars/proof-b`,
      html_url: `${context.ready.origin}/${ProofOwner}`,
      type: 'Organization',
    },
    private: true,
    fork: false,
    default_branch: ProofBranch,
    pushed_at: ProofDate,
    has_issues: true,
    archived: false,
    permissions: { admin: true, push: true, pull: true },
  }
}

function workflowPayload(context: GuidedProofContext): unknown {
  return {
    id: 700,
    name: 'Guided proof CI',
    path: '.github/workflows/guided-proof.yml',
    state: context.workflowEnabled ? 'active' : 'disabled_manually',
    html_url: `${context.ready.origin}/${ProofOwner}/${ProofRepository}/actions/workflows/guided-proof.yml`,
    created_at: ProofEarlierDate,
    updated_at: ProofDate,
  }
}

function workflowRunPayload(context: GuidedProofContext): unknown {
  return {
    id: 7001,
    workflow_id: 700,
    cancel_url: `${context.ready.endpoint}/repos/${ProofOwner}/${ProofRepository}/actions/runs/7001/cancel`,
    created_at: ProofDate,
    logs_url: `${context.ready.endpoint}/repos/${ProofOwner}/${ProofRepository}/actions/runs/7001/logs`,
    name: 'Guided proof CI',
    display_title: 'Validate guided proof fixture',
    rerun_url: `${context.ready.endpoint}/repos/${ProofOwner}/${ProofRepository}/actions/runs/7001/rerun`,
    check_suite_id: 7201,
    event: 'push',
    run_number: 3,
    run_attempt: 1,
    head_branch: ProofBranch,
    head_sha: context.options.repository.headSha,
    status: 'completed',
    conclusion: 'success',
    updated_at: ProofDate,
    html_url: `${context.ready.origin}/${ProofOwner}/${ProofRepository}/actions/runs/7001`,
    actor: context.identity('proof-b'),
  }
}

function workflowJobPayload(context: GuidedProofContext): unknown {
  return {
    id: 7101,
    name: 'Windows x64',
    status: 'completed',
    conclusion: 'success',
    completed_at: ProofDate,
    started_at: ProofDate,
    steps: [
      {
        name: 'Build deterministic proof',
        number: 1,
        status: 'completed',
        conclusion: 'success',
        completed_at: ProofDate,
        started_at: ProofDate,
        log: 'Guided proof build completed.',
      },
    ],
    html_url: `${context.ready.origin}/${ProofOwner}/${ProofRepository}/actions/runs/7001/job/7101`,
  }
}

function pullRequestPayload(
  context: GuidedProofContext,
  pullRequest: IProofPullRequest
): unknown {
  return {
    id: pullRequest.id,
    number: pullRequest.number,
    title: pullRequest.title,
    body: pullRequest.body,
    state: pullRequest.state,
    created_at: ProofEarlierDate,
    updated_at: ProofDate,
    html_url: `${context.ready.origin}/${ProofOwner}/${ProofRepository}/pull/${pullRequest.number}`,
    user: { login: 'proof-a' },
    assignees: pullRequest.assignees.map(login => ({ login })),
    requested_reviewers: pullRequest.reviewers.map(login => ({ login })),
    labels: pullRequest.labels.map(name => ({ name })),
    draft: pullRequest.draft,
    merged: pullRequest.merged,
    mergeable: pullRequest.mergeable,
    mergeable_state: pullRequest.mergeable ? 'clean' : 'blocked',
    head: {
      ref: pullRequest.headRef,
      label: pullRequest.headLabel,
      sha: context.options.repository.headSha,
      repo: { full_name: pullRequest.headRepository },
    },
    base: { ref: pullRequest.base },
  }
}

async function runUploadPack(
  context: GuidedProofContext,
  args: ReadonlyArray<string>,
  requestBody: Buffer | null,
  gitProtocol: string | undefined
): Promise<Buffer> {
  return await new Promise<Buffer>((resolvePromise, reject) => {
    const child = spawn('git', args, {
      env: createGuidedProofChildEnvironment(
        process.env,
        gitProtocol === 'version=2' ? { GIT_PROTOCOL: gitProtocol } : {}
      ),
      shell: false,
      windowsHide: true,
      stdio: ['pipe', 'pipe', 'pipe'],
    })
    context.activeUploadPacks.add(child)
    const stdout = new Array<Buffer>()
    let stdoutBytes = 0
    let stderrBytes = 0
    let settled = false
    let terminationReason: string | null = null
    let escalation: NodeJS.Timeout | null = null
    const terminate = () => {
      if (settled || terminationReason !== null) {
        return
      }
      terminationReason = 'The guided proof upload-pack process failed.'
      child.kill()
      escalation = setTimeout(
        () => child.kill('SIGKILL'),
        ProofChildShutdownGraceMilliseconds
      )
    }
    const timeout = setTimeout(() => {
      terminate()
    }, ProofChildMaximumRuntimeMilliseconds)
    child.stdout.on('data', (chunk: Buffer) => {
      stdoutBytes += chunk.length
      if (stdoutBytes > ProofChildOutputMaximumBytes) {
        terminate()
        return
      }
      stdout.push(chunk)
    })
    child.stderr.on('data', (chunk: Buffer) => {
      stderrBytes += chunk.length
      if (stderrBytes > ProofChildOutputMaximumBytes) {
        terminate()
      }
    })
    child.once('error', terminate)
    child.once('close', code => {
      context.activeUploadPacks.delete(child)
      if (settled) {
        return
      }
      settled = true
      clearTimeout(timeout)
      if (escalation !== null) {
        clearTimeout(escalation)
      }
      if (
        terminationReason !== null ||
        code !== 0 ||
        stdoutBytes > ProofChildOutputMaximumBytes ||
        stderrBytes > ProofChildOutputMaximumBytes
      ) {
        reject(new Error('The guided proof upload-pack process failed.'))
        return
      }
      resolvePromise(Buffer.concat(stdout))
    })
    child.stdin.once('error', terminate)
    child.stdin.end(requestBody ?? undefined)
  })
}

async function handleGitRequest(
  context: GuidedProofContext,
  request: IncomingMessage,
  response: ServerResponse,
  url: URL,
  audit: IProofAudit
): Promise<void> {
  if (audit.account !== 'proof-b') {
    audit.route = 'git-authentication'
    if (audit.account === 'proof-a') {
      sendJSON(response, 404, {
        message: 'Repository not found for this guided proof identity.',
      })
    } else {
      sendAuthenticationRequired(response)
    }
    return
  }
  const gitProtocol =
    request.headers['git-protocol'] === 'version=2' ? 'version=2' : undefined
  if (url.pathname === `${ProofGitPath}/info/refs`) {
    audit.route = 'git-upload-pack-advertisement'
    if (!requireMethod(request, response, ['GET'])) {
      return
    }
    requireOnlyQuery(url, ['service'])
    if (url.searchParams.get('service') !== 'git-upload-pack') {
      throw new ProofRequestError(400, 'invalid-git-service')
    }
    const advertisement = await runUploadPack(
      context,
      [
        'upload-pack',
        '--stateless-rpc',
        '--advertise-refs',
        context.options.repository.bareRepositoryPath,
      ],
      null,
      gitProtocol
    )
    const service = Buffer.from('# service=git-upload-pack\n', 'utf8')
    const packetLength = Buffer.from(
      (service.length + 4).toString(16).padStart(4, '0'),
      'ascii'
    )
    sendBytes(
      response,
      200,
      'application/x-git-upload-pack-advertisement',
      Buffer.concat([
        packetLength,
        service,
        Buffer.from('0000'),
        advertisement,
      ]),
      {},
      ProofGitResponseMaximumBytes
    )
    return
  }
  if (url.pathname === `${ProofGitPath}/git-upload-pack`) {
    audit.route = 'git-upload-pack'
    if (!requireMethod(request, response, ['POST'])) {
      return
    }
    requireOnlyQuery(url, [])
    const contentType = request.headers['content-type'] ?? ''
    if (
      !contentType
        .toLowerCase()
        .startsWith('application/x-git-upload-pack-request')
    ) {
      throw new ProofRequestError(415, 'unsupported-content-type')
    }
    const requestBody = await readBody(request)
    const result = await runUploadPack(
      context,
      [
        'upload-pack',
        '--stateless-rpc',
        context.options.repository.bareRepositoryPath,
      ],
      requestBody,
      gitProtocol
    )
    sendBytes(
      response,
      200,
      'application/x-git-upload-pack-result',
      result,
      {},
      ProofGitResponseMaximumBytes
    )
    return
  }
  audit.route = 'rejected-git-route'
  sendJSON(response, 404, { message: 'Unknown guided proof Git route.' })
}

async function handleAccountAndRepositoryAPI(
  context: GuidedProofContext,
  request: IncomingMessage,
  response: ServerResponse,
  url: URL,
  path: string,
  audit: IProofAudit
): Promise<boolean> {
  const avatar = /^\/enterprise\/avatars\/(proof-a|proof-b)$/.exec(path)
  if (avatar !== null) {
    audit.route = 'api-avatar'
    if (!requireMethod(request, response, ['GET'])) {
      return true
    }
    requireOnlyQuery(url, [])
    sendBytes(
      response,
      200,
      'image/svg+xml; charset=utf-8',
      Buffer.from(
        `<svg xmlns="http://www.w3.org/2000/svg" width="64" height="64" viewBox="0 0 64 64"><rect width="64" height="64" rx="32" fill="#0969da"/><text x="32" y="40" text-anchor="middle" font-family="sans-serif" font-size="24" fill="white">${
          avatar[1] === 'proof-a' ? 'A' : 'B'
        }</text></svg>`,
        'utf8'
      )
    )
    return true
  }
  const account =
    audit.account === 'proof-a' || audit.account === 'proof-b'
      ? audit.account
      : null
  if (account === null) {
    sendAuthenticationRequired(response)
    return true
  }
  if (path === '/user') {
    audit.route = 'api-account'
    if (!requireMethod(request, response, ['GET'])) {
      return true
    }
    requireOnlyQuery(url, [])
    sendJSON(response, 200, context.identity(account))
    return true
  }
  if (path === '/user/emails') {
    audit.route = 'api-account-emails'
    if (!requireMethod(request, response, ['GET'])) {
      return true
    }
    requireOnlyQuery(url, [])
    sendJSON(response, 200, [
      {
        email: `${account}@example.invalid`,
        verified: true,
        primary: true,
        visibility: 'private',
      },
    ])
    return true
  }
  if (path === '/user/orgs') {
    audit.route = 'api-account-organizations'
    if (!requireMethod(request, response, ['GET'])) {
      return true
    }
    requireOnlyQuery(url, ['per_page', 'page'])
    boundedIntegerQuery(url, 'per_page', 1, 100, 100)
    boundedIntegerQuery(url, 'page', 1, 10, 1)
    sendJSON(response, 200, [])
    return true
  }
  if (path === '/user/repos') {
    audit.route = 'api-account-repositories'
    if (!requireMethod(request, response, ['GET'])) {
      return true
    }
    requireOnlyQuery(url, ['affiliation', 'per_page', 'page'])
    boundedIntegerQuery(url, 'per_page', 1, 100, 100)
    const page = boundedIntegerQuery(url, 'page', 1, 10, 1)
    const affiliation = url.searchParams.get('affiliation')
    if (
      affiliation !== null &&
      !['owner', 'collaborator', 'organization_member'].includes(affiliation)
    ) {
      throw new ProofRequestError(400, 'invalid-affiliation')
    }
    sendJSON(response, 200, page === 1 ? [repositoryPayload(context)] : [])
    return true
  }
  if (path === '/desktop_internal/features') {
    audit.route = 'api-account-features'
    if (!requireMethod(request, response, ['GET'])) {
      return true
    }
    requireOnlyQuery(url, [])
    sendJSON(response, 200, { features: [] })
    return true
  }
  const user = /^\/users\/(proof-a|proof-b)$/.exec(path)
  if (user !== null) {
    audit.route = 'api-user-profile'
    if (!requireMethod(request, response, ['GET'])) {
      return true
    }
    requireOnlyQuery(url, [])
    sendJSON(response, 200, context.identity(user[1] as 'proof-a' | 'proof-b'))
    return true
  }
  const repositoryPath = `/repos/${ProofOwner}/${ProofRepository}`
  if (path === repositoryPath) {
    audit.route = 'api-repository'
    if (!requireMethod(request, response, ['GET'])) {
      return true
    }
    requireOnlyQuery(url, [])
    sendJSON(response, 200, repositoryPayload(context))
    return true
  }
  if (path === `${repositoryPath}/git`) {
    audit.route = 'api-repository-poll'
    if (!requireMethod(request, response, ['HEAD'])) {
      return true
    }
    requireOnlyQuery(url, [])
    response.writeHead(200, {
      'Cache-Control': 'no-store',
      'Content-Length': '0',
      'X-Poll-Interval': '60',
    })
    response.end()
    return true
  }
  return false
}

function issueByNumber(
  context: GuidedProofContext,
  issueNumber: number
): IProofIssue {
  const issue = context.issues.find(
    candidate => candidate.number === issueNumber
  )
  if (issue === undefined) {
    throw new ProofRequestError(404, 'issue-not-found')
  }
  return issue
}

function parseStringArray(
  value: unknown,
  maximumItems: number,
  maximumLength: number
): ReadonlyArray<string> {
  if (!Array.isArray(value) || value.length > maximumItems) {
    throw new ProofRequestError(400, 'invalid-array')
  }
  const result = value.map(item => boundedString(item, maximumLength))
  if (new Set(result).size !== result.length) {
    throw new ProofRequestError(400, 'duplicate-array-item')
  }
  return result
}

async function createIssue(
  context: GuidedProofContext,
  request: IncomingMessage
): Promise<IProofIssue> {
  const body = await readJSONObject(request)
  requireOnlyFields(body, ['title', 'body'])
  if (context.issues.length >= ProofIssueMaximumCount) {
    throw new ProofRequestError(409, 'issue-limit-reached')
  }
  const title = boundedString(body.title, 256)
  const issueBody = boundedString(body.body, ProofIssueBodyMaximumLength, true)
  const nextNumber = Math.max(...context.issues.map(issue => issue.number)) + 1
  const issue: IProofIssue = {
    id: 7000 + nextNumber,
    number: nextNumber,
    title,
    body: issueBody,
    state: 'open',
    state_reason: null,
    user: { login: 'proof-b' },
    created_at: ProofDate,
    updated_at: ProofDate,
    closed_at: null,
    html_url: `${context.ready.origin}/${ProofOwner}/${ProofRepository}/issues/${nextNumber}`,
    labels: [],
    assignees: [],
    milestone: null,
    comments: 0,
    locked: false,
  }
  context.issues.push(issue)
  context.comments.set(nextNumber, [])
  return issue
}

async function updateIssue(
  context: GuidedProofContext,
  request: IncomingMessage,
  issue: IProofIssue
): Promise<IProofIssue> {
  const body = await readJSONObject(request)
  requireOnlyFields(body, [
    'title',
    'body',
    'labels',
    'assignees',
    'milestone',
    'state',
  ])
  if (body.title !== undefined) {
    issue.title = boundedString(body.title, 256)
  }
  if (body.body !== undefined) {
    issue.body = boundedString(body.body, ProofIssueBodyMaximumLength, true)
  }
  if (body.labels !== undefined) {
    const names = parseStringArray(body.labels, 50, 255)
    issue.labels = names.map(name => {
      const label = context.labels.find(candidate => candidate.name === name)
      if (label === undefined) {
        throw new ProofRequestError(422, 'unknown-label')
      }
      return label
    })
  }
  if (body.assignees !== undefined) {
    const logins = parseStringArray(body.assignees, 25, 255)
    if (logins.some(login => !context.assignees.includes(login))) {
      throw new ProofRequestError(422, 'unknown-assignee')
    }
    issue.assignees = logins.map(login => ({ login }))
  }
  if (body.milestone !== undefined) {
    if (body.milestone === null) {
      issue.milestone = null
    } else if (body.milestone === context.milestones[0].number) {
      issue.milestone = context.milestones[0]
    } else {
      throw new ProofRequestError(422, 'unknown-milestone')
    }
  }
  if (body.state !== undefined) {
    if (body.state !== 'open' && body.state !== 'closed') {
      throw new ProofRequestError(422, 'invalid-state')
    }
    issue.state = body.state
    issue.state_reason = body.state === 'closed' ? 'completed' : 'reopened'
    issue.closed_at = body.state === 'closed' ? ProofDate : null
  }
  issue.updated_at = ProofDate
  return issue
}

function pullRequestByNumber(
  context: GuidedProofContext,
  pullRequestNumber: number
): IProofPullRequest {
  const pullRequest = context.pullRequests.find(
    candidate => candidate.number === pullRequestNumber
  )
  if (pullRequest === undefined) {
    throw new ProofRequestError(404, 'pull-request-not-found')
  }
  return pullRequest
}

function parsePullRequestLogins(
  context: GuidedProofContext,
  value: unknown
): string[] {
  const allowed = new Set(['proof-a', ...context.assignees])
  const values = parseStringArray(value, 15, 100)
  if (values.some(login => !allowed.has(login))) {
    throw new ProofRequestError(422, 'unknown-pull-request-login')
  }
  return [...values]
}

function parsePullRequestLabels(
  context: GuidedProofContext,
  value: unknown
): string[] {
  const allowed = new Set(context.labels.map(label => label.name))
  const values = parseStringArray(value, 15, 50)
  if (values.some(label => !allowed.has(label))) {
    throw new ProofRequestError(422, 'unknown-pull-request-label')
  }
  return [...values]
}

async function createPullRequest(
  context: GuidedProofContext,
  request: IncomingMessage
): Promise<IProofPullRequest> {
  if (context.pullRequests.length >= ProofPullRequestMaximumCount) {
    throw new ProofRequestError(409, 'pull-request-cap-reached')
  }
  const body = await readJSONObject(request)
  requireOnlyFields(body, [
    'title',
    'body',
    'head',
    'head_repo',
    'base',
    'draft',
  ])
  const title = boundedString(body.title, 256)
  const pullRequestBody = boundedString(
    body.body,
    ProofIssueBodyMaximumLength,
    true
  )
  const head = boundedGitReference(body.head)
  const headSeparator = head.indexOf(':')
  if (headSeparator !== -1 && head.indexOf(':', headSeparator + 1) !== -1) {
    throw new ProofRequestError(422, 'invalid-pull-request-head')
  }
  const headOwner =
    headSeparator === -1 ? ProofOwner : head.slice(0, headSeparator)
  const headRef = headSeparator === -1 ? head : head.slice(headSeparator + 1)
  if (!['proof-a', ProofOwner].includes(headOwner)) {
    throw new ProofRequestError(422, 'unknown-pull-request-head-owner')
  }
  boundedGitReference(headRef)
  const base = boundedGitReference(body.base)
  if (headSeparator === -1 && headRef === base) {
    throw new ProofRequestError(422, 'matching-pull-request-branches')
  }
  const headRepositoryName =
    body.head_repo === undefined
      ? ProofRepository
      : boundedString(body.head_repo, 100)
  if (headRepositoryName !== ProofRepository) {
    throw new ProofRequestError(422, 'unknown-pull-request-head-repository')
  }
  const draft = booleanField(body.draft)
  const nextNumber =
    Math.max(...context.pullRequests.map(item => item.number)) + 1
  const pullRequest: IProofPullRequest = {
    id: 8000 + nextNumber,
    number: nextNumber,
    title,
    body: pullRequestBody,
    headRef,
    headLabel: `${headOwner}:${headRef}`,
    headRepository: `${headOwner}/${headRepositoryName}`,
    base,
    draft,
    state: 'open',
    merged: false,
    mergeable: true,
    reviewers: [],
    assignees: [],
    labels: [],
  }
  context.pullRequests.push(pullRequest)
  return pullRequest
}

async function updatePullRequest(
  request: IncomingMessage,
  pullRequest: IProofPullRequest
): Promise<IProofPullRequest> {
  if (pullRequest.merged) {
    throw new ProofRequestError(409, 'pull-request-already-merged')
  }
  const body = await readJSONObject(request)
  requireOnlyFields(body, ['title', 'body', 'base', 'state'])
  const fields = Object.keys(body)
  if (
    fields.length === 0 ||
    (body.state !== undefined &&
      (fields.length !== 1 ||
        !['open', 'closed'].includes(body.state as string)))
  ) {
    throw new ProofRequestError(422, 'invalid-pull-request-update')
  }
  const candidate = { ...pullRequest }
  if (body.title !== undefined) {
    candidate.title = boundedString(body.title, 256)
  }
  if (body.body !== undefined) {
    candidate.body = boundedString(body.body, ProofIssueBodyMaximumLength, true)
  }
  if (body.base !== undefined) {
    candidate.base = boundedGitReference(body.base)
    if (
      candidate.headLabel.startsWith(`${ProofOwner}:`) &&
      candidate.base === candidate.headRef
    ) {
      throw new ProofRequestError(422, 'matching-pull-request-branches')
    }
  }
  if (body.state !== undefined) {
    candidate.state = body.state as 'open' | 'closed'
  }
  Object.assign(pullRequest, candidate)
  return pullRequest
}

async function updatePullRequestMetadata(
  context: GuidedProofContext,
  request: IncomingMessage,
  pullRequest: IProofPullRequest
): Promise<void> {
  if (pullRequest.merged) {
    throw new ProofRequestError(409, 'pull-request-already-merged')
  }
  const body = await readJSONObject(request)
  requireOnlyFields(body, ['assignees', 'labels'])
  if (body.assignees === undefined || body.labels === undefined) {
    throw new ProofRequestError(422, 'missing-pull-request-metadata')
  }
  pullRequest.assignees = parsePullRequestLogins(context, body.assignees)
  pullRequest.labels = parsePullRequestLabels(context, body.labels)
}

interface IProofSearchToken {
  readonly value: string
  readonly entirelyQuoted: boolean
}

interface IProofIssueSearch {
  readonly state: 'open' | 'closed' | 'all'
  readonly labels: ReadonlyArray<string>
  readonly assignee: string | null
  readonly milestone: number | null
  readonly terms: ReadonlyArray<string>
}

function tokenizeProofIssueSearch(
  query: string
): ReadonlyArray<IProofSearchToken> {
  const tokens = new Array<IProofSearchToken>()
  let value = ''
  let inQuote = false
  let escaped = false
  let quoteStartedAt = -1
  let entirelyQuoted = false
  let quoteClosed = false

  const push = () => {
    if (value.length === 0) {
      throw new ProofRequestError(400, 'invalid-search-query')
    }
    tokens.push({ value, entirelyQuoted })
    value = ''
    quoteStartedAt = -1
    entirelyQuoted = false
    quoteClosed = false
  }

  for (const character of query) {
    if (escaped) {
      if (character !== '"' && character !== '\\') {
        throw new ProofRequestError(400, 'invalid-search-query')
      }
      value += character
      escaped = false
      continue
    }
    if (inQuote) {
      if (character === '\\') {
        escaped = true
      } else if (character === '"') {
        inQuote = false
        quoteClosed = true
      } else {
        value += character
      }
      continue
    }
    if (/\s/.test(character)) {
      if (value.length > 0 || quoteClosed) {
        push()
      }
      continue
    }
    if (quoteClosed) {
      throw new ProofRequestError(400, 'invalid-search-query')
    }
    if (character === '"') {
      if (value.length > 0 && !value.endsWith(':')) {
        throw new ProofRequestError(400, 'invalid-search-query')
      }
      quoteStartedAt = value.length
      entirelyQuoted = quoteStartedAt === 0
      inQuote = true
      continue
    }
    value += character
  }
  if (inQuote || escaped) {
    throw new ProofRequestError(400, 'invalid-search-query')
  }
  if (value.length > 0 || quoteClosed) {
    push()
  }
  if (tokens.length === 0 || tokens.length > 32) {
    throw new ProofRequestError(400, 'invalid-search-query')
  }
  return tokens
}

function parseProofIssueSearch(query: string): IProofIssueSearch {
  let hasRepository = false
  let hasIssueKind = false
  let hasLocation = false
  let state: IProofIssueSearch['state'] = 'all'
  let hasState = false
  let assignee: string | null = null
  let hasAssignee = false
  let milestone: number | null = null
  let hasMilestone = false
  const labels = new Array<string>()
  const terms = new Array<string>()

  for (const token of tokenizeProofIssueSearch(query)) {
    if (token.value === `repo:${ProofOwner}/${ProofRepository}`) {
      if (hasRepository) {
        throw new ProofRequestError(400, 'invalid-search-query')
      }
      hasRepository = true
      continue
    }
    if (token.value === 'is:issue') {
      if (hasIssueKind) {
        throw new ProofRequestError(400, 'invalid-search-query')
      }
      hasIssueKind = true
      continue
    }
    const stateMatch = /^(?:is|state):(open|closed|all)$/.exec(token.value)
    if (stateMatch !== null) {
      if (hasState) {
        throw new ProofRequestError(400, 'invalid-search-query')
      }
      state = stateMatch[1] as IProofIssueSearch['state']
      hasState = true
      continue
    }
    if (token.value.startsWith('label:')) {
      const label = boundedString(token.value.slice('label:'.length), 100)
      if (labels.length >= 20 || labels.includes(label.toLowerCase())) {
        throw new ProofRequestError(400, 'invalid-search-query')
      }
      labels.push(label.toLowerCase())
      continue
    }
    if (token.value.startsWith('assignee:')) {
      if (hasAssignee) {
        throw new ProofRequestError(400, 'invalid-search-query')
      }
      assignee = boundedString(token.value.slice('assignee:'.length), 255)
      hasAssignee = true
      continue
    }
    if (token.value.startsWith('milestone:')) {
      if (hasMilestone || !/^milestone:[1-9][0-9]*$/.test(token.value)) {
        throw new ProofRequestError(400, 'invalid-search-query')
      }
      milestone = Number.parseInt(token.value.slice('milestone:'.length), 10)
      if (!Number.isSafeInteger(milestone)) {
        throw new ProofRequestError(400, 'invalid-search-query')
      }
      hasMilestone = true
      continue
    }
    if (token.value === 'in:title,body') {
      if (hasLocation) {
        throw new ProofRequestError(400, 'invalid-search-query')
      }
      hasLocation = true
      continue
    }
    if (!token.entirelyQuoted && token.value.includes(':')) {
      throw new ProofRequestError(400, 'unsupported-search-qualifier')
    }
    if (terms.length >= 8) {
      throw new ProofRequestError(400, 'invalid-search-query')
    }
    terms.push(boundedString(token.value, 256).toLowerCase())
  }
  if (!hasRepository || !hasIssueKind) {
    throw new ProofRequestError(400, 'unscoped-search')
  }
  return { state, labels, assignee, milestone, terms }
}

function filterProofIssuesForSearch(
  context: GuidedProofContext,
  search: IProofIssueSearch
): ReadonlyArray<IProofIssue> {
  return context.issues.filter(issue => {
    const searchableText = `${issue.title}\n${issue.body}`.toLowerCase()
    return (
      (search.state === 'all' || issue.state === search.state) &&
      search.labels.every(label =>
        issue.labels.some(candidate => candidate.name.toLowerCase() === label)
      ) &&
      (search.assignee === null ||
        issue.assignees.some(
          candidate =>
            candidate.login.toLowerCase() === search.assignee?.toLowerCase()
        )) &&
      (search.milestone === null ||
        issue.milestone?.number === search.milestone) &&
      search.terms.every(term => searchableText.includes(term))
    )
  })
}

async function handleIssuesAPI(
  context: GuidedProofContext,
  request: IncomingMessage,
  response: ServerResponse,
  url: URL,
  path: string,
  audit: IProofAudit
): Promise<boolean> {
  const repositoryPath = `/repos/${ProofOwner}/${ProofRepository}`
  if (path === '/search/issues') {
    audit.route = 'api-issue-search'
    if (!requireMethod(request, response, ['GET'])) {
      return true
    }
    requireOnlyQuery(url, ['q', 'per_page', 'page', 'sort', 'order'])
    const perPage = boundedIntegerQuery(url, 'per_page', 1, 30, 30)
    const page = boundedIntegerQuery(url, 'page', 1, 10, 1)
    const query = boundedString(url.searchParams.get('q'), 4096)
    const sort = url.searchParams.get('sort') ?? 'updated'
    const order = url.searchParams.get('order') ?? 'desc'
    if (!['created', 'updated', 'comments'].includes(sort)) {
      throw new ProofRequestError(400, 'invalid-search-sort')
    }
    if (order !== 'asc' && order !== 'desc') {
      throw new ProofRequestError(400, 'invalid-search-order')
    }
    const search = parseProofIssueSearch(query)
    const matchingIssues = [...filterProofIssuesForSearch(context, search)]
    const direction = order === 'asc' ? 1 : -1
    matchingIssues.sort((left, right) => {
      const leftValue =
        sort === 'created'
          ? Date.parse(left.created_at)
          : sort === 'comments'
          ? left.comments
          : Date.parse(left.updated_at)
      const rightValue =
        sort === 'created'
          ? Date.parse(right.created_at)
          : sort === 'comments'
          ? right.comments
          : Date.parse(right.updated_at)
      return (leftValue - rightValue || left.number - right.number) * direction
    })
    const start = (page - 1) * perPage
    sendJSON(response, 200, {
      total_count: matchingIssues.length,
      incomplete_results: false,
      items: matchingIssues.slice(start, start + perPage),
    })
    return true
  }
  if (path === `${repositoryPath}/issues`) {
    audit.route = 'api-issues'
    if (!requireMethod(request, response, ['GET', 'POST'])) {
      return true
    }
    if (request.method === 'POST') {
      requireOnlyQuery(url, [])
      sendJSON(response, 201, await createIssue(context, request))
      return true
    }
    requireOnlyQuery(url, [
      'state',
      'since',
      'per_page',
      'page',
      'sort',
      'direction',
      'labels',
      'assignee',
      'milestone',
    ])
    const perPage = boundedIntegerQuery(url, 'per_page', 1, 100, 30)
    const page = boundedIntegerQuery(url, 'page', 1, 10, 1)
    const state = url.searchParams.get('state') ?? 'open'
    if (!['open', 'closed', 'all'].includes(state)) {
      throw new ProofRequestError(400, 'invalid-state')
    }
    const issues = context.issues.filter(
      issue => state === 'all' || issue.state === state
    )
    sendJSON(response, 200, page === 1 ? issues.slice(0, perPage) : [])
    return true
  }
  if (path === `${repositoryPath}/pulls`) {
    audit.route = 'api-pull-requests'
    if (!requireMethod(request, response, ['GET', 'POST'])) {
      return true
    }
    if (request.method === 'POST') {
      requireOnlyQuery(url, [])
      const pullRequest = await createPullRequest(context, request)
      sendJSON(response, 201, pullRequestPayload(context, pullRequest))
      return true
    }
    requireOnlyQuery(url, ['state', 'sort', 'direction', 'page', 'per_page'])
    const perPage = boundedIntegerQuery(url, 'per_page', 1, 100, 50)
    const page = boundedIntegerQuery(url, 'page', 1, 10, 1)
    const state = url.searchParams.get('state') ?? 'open'
    if (!['open', 'closed', 'all'].includes(state)) {
      throw new ProofRequestError(400, 'invalid-state')
    }
    const matching = context.pullRequests.filter(
      pullRequest => state === 'all' || pullRequest.state === state
    )
    const offset = (page - 1) * perPage
    sendJSON(
      response,
      200,
      matching
        .slice(offset, offset + perPage)
        .map(pullRequest => pullRequestPayload(context, pullRequest))
    )
    return true
  }
  const pullRequestMatch = new RegExp(
    `^${repositoryPath}/pulls/([1-9][0-9]*)$`
  ).exec(path)
  if (pullRequestMatch !== null) {
    audit.route = 'api-pull-request-lifecycle'
    if (!requireMethod(request, response, ['GET', 'PATCH'])) {
      return true
    }
    requireOnlyQuery(url, [])
    const pullRequest = pullRequestByNumber(
      context,
      Number.parseInt(pullRequestMatch[1], 10)
    )
    if (request.method === 'PATCH') {
      await updatePullRequest(request, pullRequest)
    }
    sendJSON(response, 200, pullRequestPayload(context, pullRequest))
    return true
  }
  const requestedReviewersMatch = new RegExp(
    `^${repositoryPath}/pulls/([1-9][0-9]*)/requested_reviewers$`
  ).exec(path)
  if (requestedReviewersMatch !== null) {
    audit.route = 'api-pull-request-reviewers'
    if (!requireMethod(request, response, ['POST', 'DELETE'])) {
      return true
    }
    requireOnlyQuery(url, [])
    const pullRequest = pullRequestByNumber(
      context,
      Number.parseInt(requestedReviewersMatch[1], 10)
    )
    if (pullRequest.merged) {
      throw new ProofRequestError(409, 'pull-request-already-merged')
    }
    const body = await readJSONObject(request)
    requireOnlyFields(body, ['reviewers'])
    const reviewers = parsePullRequestLogins(context, body.reviewers)
    const current = new Map(
      pullRequest.reviewers.map(login => [login.toLowerCase(), login])
    )
    if (request.method === 'POST') {
      reviewers.forEach(login => current.set(login.toLowerCase(), login))
    } else {
      reviewers.forEach(login => current.delete(login.toLowerCase()))
    }
    pullRequest.reviewers = [...current.values()]
    sendJSON(response, 200, pullRequestPayload(context, pullRequest))
    return true
  }
  const pullRequestReviewsMatch = new RegExp(
    `^${repositoryPath}/pulls/([1-9][0-9]*)/reviews$`
  ).exec(path)
  if (pullRequestReviewsMatch !== null) {
    audit.route = 'api-pull-request-review'
    if (!requireMethod(request, response, ['POST'])) {
      return true
    }
    requireOnlyQuery(url, [])
    const pullRequest = pullRequestByNumber(
      context,
      Number.parseInt(pullRequestReviewsMatch[1], 10)
    )
    if (
      pullRequest.state !== 'open' ||
      pullRequest.merged ||
      context.pullRequestReviews.length >= ProofPullRequestReviewMaximumCount
    ) {
      throw new ProofRequestError(409, 'pull-request-review-unavailable')
    }
    const body = await readJSONObject(request)
    requireOnlyFields(body, ['event', 'body'])
    const event = boundedString(body.event, 32)
    if (!['APPROVE', 'REQUEST_CHANGES', 'COMMENT'].includes(event)) {
      throw new ProofRequestError(422, 'invalid-pull-request-review-event')
    }
    const reviewBody = boundedString(
      body.body,
      ProofIssueBodyMaximumLength,
      true
    )
    if (event === 'REQUEST_CHANGES' && reviewBody.trim() === '') {
      throw new ProofRequestError(422, 'missing-pull-request-review-body')
    }
    const state =
      event === 'APPROVE'
        ? 'APPROVED'
        : event === 'REQUEST_CHANGES'
        ? 'CHANGES_REQUESTED'
        : 'COMMENTED'
    const review: IProofPullRequestReview = {
      id: 8801 + context.pullRequestReviews.length,
      pullRequestNumber: pullRequest.number,
      state,
      body: reviewBody,
    }
    context.pullRequestReviews.push(review)
    sendJSON(response, 200, { id: review.id, state: review.state })
    return true
  }
  const pullRequestMergeMatch = new RegExp(
    `^${repositoryPath}/pulls/([1-9][0-9]*)/merge$`
  ).exec(path)
  if (pullRequestMergeMatch !== null) {
    audit.route = 'api-pull-request-merge'
    if (!requireMethod(request, response, ['PUT'])) {
      return true
    }
    requireOnlyQuery(url, [])
    const pullRequest = pullRequestByNumber(
      context,
      Number.parseInt(pullRequestMergeMatch[1], 10)
    )
    if (
      pullRequest.state !== 'open' ||
      pullRequest.merged ||
      pullRequest.draft ||
      !pullRequest.mergeable
    ) {
      throw new ProofRequestError(409, 'pull-request-merge-unavailable')
    }
    const body = await readJSONObject(request)
    requireOnlyFields(body, ['sha', 'merge_method'])
    if (body.sha !== context.options.repository.headSha) {
      throw new ProofRequestError(409, 'pull-request-head-changed')
    }
    if (!['merge', 'squash', 'rebase'].includes(body.merge_method as string)) {
      throw new ProofRequestError(422, 'invalid-pull-request-merge-method')
    }
    pullRequest.merged = true
    pullRequest.mergeable = false
    pullRequest.state = 'closed'
    sendJSON(response, 200, {
      merged: true,
      sha: context.options.repository.headSha,
      message: 'Pull request merged.',
    })
    return true
  }
  const issueMatch = new RegExp(
    `^${repositoryPath}/issues/([1-9][0-9]*)$`
  ).exec(path)
  if (issueMatch !== null) {
    const issueNumber = Number.parseInt(issueMatch[1], 10)
    const pullRequest = context.pullRequests.find(
      candidate => candidate.number === issueNumber
    )
    if (pullRequest !== undefined) {
      audit.route = 'api-pull-request-metadata'
      if (!requireMethod(request, response, ['PATCH'])) {
        return true
      }
      requireOnlyQuery(url, [])
      await updatePullRequestMetadata(context, request, pullRequest)
      sendJSON(response, 200, pullRequestPayload(context, pullRequest))
      return true
    }
    audit.route = 'api-issue-detail'
    if (!requireMethod(request, response, ['GET', 'PATCH'])) {
      return true
    }
    requireOnlyQuery(url, [])
    const issue = issueByNumber(context, issueNumber)
    if (request.method === 'PATCH') {
      await updateIssue(context, request, issue)
    }
    sendJSON(response, 200, issue)
    return true
  }
  const commentsMatch = new RegExp(
    `^${repositoryPath}/issues/([1-9][0-9]*)/comments$`
  ).exec(path)
  if (commentsMatch !== null) {
    audit.route = 'api-issue-comments'
    if (!requireMethod(request, response, ['GET', 'POST'])) {
      return true
    }
    const issueNumber = Number.parseInt(commentsMatch[1], 10)
    const issue = issueByNumber(context, issueNumber)
    const comments = context.comments.get(issueNumber) ?? []
    if (request.method === 'GET') {
      requireOnlyQuery(url, ['per_page', 'page'])
      const perPage = boundedIntegerQuery(url, 'per_page', 1, 30, 30)
      const page = boundedIntegerQuery(url, 'page', 1, 10, 1)
      sendJSON(response, 200, page === 1 ? comments.slice(0, perPage) : [])
      return true
    }
    requireOnlyQuery(url, [])
    const body = await readJSONObject(request)
    requireOnlyFields(body, ['body'])
    if (comments.length >= ProofIssueCommentMaximumCount) {
      throw new ProofRequestError(409, 'issue-comment-limit-reached')
    }
    const commentBody = boundedString(body.body, 65_536)
    const comment: IProofComment = {
      id: 7701 + comments.length,
      body: commentBody,
      user: { login: 'proof-b' },
      created_at: ProofDate,
      updated_at: ProofDate,
      html_url: `${issue.html_url}#issuecomment-${7701 + comments.length}`,
    }
    comments.push(comment)
    context.comments.set(issueNumber, comments)
    issue.comments = comments.length
    issue.updated_at = ProofDate
    sendJSON(response, 201, comment)
    return true
  }
  if (path === `${repositoryPath}/labels`) {
    audit.route = 'api-issue-labels'
    if (!requireMethod(request, response, ['GET'])) {
      return true
    }
    requireOnlyQuery(url, ['per_page', 'page'])
    boundedIntegerQuery(url, 'per_page', 1, 100, 100)
    const page = boundedIntegerQuery(url, 'page', 1, 5, 1)
    sendJSON(response, 200, page === 1 ? context.labels : [])
    return true
  }
  if (path === `${repositoryPath}/assignees`) {
    audit.route = 'api-issue-assignees'
    if (!requireMethod(request, response, ['GET'])) {
      return true
    }
    requireOnlyQuery(url, ['per_page', 'page'])
    boundedIntegerQuery(url, 'per_page', 1, 100, 100)
    const page = boundedIntegerQuery(url, 'page', 1, 5, 1)
    sendJSON(
      response,
      200,
      page === 1 ? context.assignees.map(login => ({ login })) : []
    )
    return true
  }
  if (path === `${repositoryPath}/milestones`) {
    audit.route = 'api-issue-milestones'
    if (!requireMethod(request, response, ['GET'])) {
      return true
    }
    requireOnlyQuery(url, ['state', 'per_page', 'page'])
    if ((url.searchParams.get('state') ?? 'all') !== 'all') {
      throw new ProofRequestError(400, 'invalid-state')
    }
    boundedIntegerQuery(url, 'per_page', 1, 100, 100)
    const page = boundedIntegerQuery(url, 'page', 1, 5, 1)
    sendJSON(response, 200, page === 1 ? context.milestones : [])
    return true
  }
  return false
}

function releaseById(context: GuidedProofContext, id: number): IProofRelease {
  const release = context.releases.find(candidate => candidate.id === id)
  if (release === undefined) {
    throw new ProofRequestError(404, 'release-not-found')
  }
  return release
}

function releaseAssetById(
  context: GuidedProofContext,
  id: number
): { readonly release: IProofRelease; readonly asset: IProofReleaseAsset } {
  for (const release of context.releases) {
    const asset = release.assets.find(candidate => candidate.id === id)
    if (asset !== undefined) {
      return { release, asset }
    }
  }
  throw new ProofRequestError(404, 'release-asset-not-found')
}

function booleanField(value: unknown): boolean {
  if (typeof value !== 'boolean') {
    throw new ProofRequestError(400, 'invalid-field')
  }
  return value
}

async function createRelease(
  context: GuidedProofContext,
  request: IncomingMessage
): Promise<IProofRelease> {
  const body = await readJSONObject(request)
  requireOnlyFields(body, [
    'tag_name',
    'target_commitish',
    'name',
    'body',
    'draft',
    'prerelease',
  ])
  if (context.releases.length >= ProofReleaseMaximumCount) {
    throw new ProofRequestError(409, 'release-limit-reached')
  }
  const release: IProofRelease = {
    id: Math.max(...context.releases.map(item => item.id)) + 1,
    tag_name: boundedString(body.tag_name, 255),
    target_commitish: boundedString(body.target_commitish, 1024),
    name: boundedString(body.name, 1024, true),
    body: boundedString(body.body, 125_000, true),
    draft: booleanField(body.draft),
    prerelease: booleanField(body.prerelease),
    created_at: ProofDate,
    published_at: null,
    author: { login: 'proof-b' },
    assets: [],
  }
  if (!release.draft) {
    throw new ProofRequestError(422, 'release-must-start-as-draft')
  }
  context.releases.push(release)
  return release
}

async function updateRelease(
  request: IncomingMessage,
  release: IProofRelease
): Promise<IProofRelease> {
  const body = await readJSONObject(request)
  requireOnlyFields(body, [
    'tag_name',
    'target_commitish',
    'name',
    'body',
    'draft',
    'prerelease',
  ])
  if (body.tag_name !== undefined) {
    release.tag_name = boundedString(body.tag_name, 255)
  }
  if (body.target_commitish !== undefined) {
    release.target_commitish = boundedString(body.target_commitish, 1024)
  }
  if (body.name !== undefined) {
    release.name = boundedString(body.name, 1024, true)
  }
  if (body.body !== undefined) {
    release.body = boundedString(body.body, 125_000, true)
  }
  if (body.prerelease !== undefined) {
    release.prerelease = booleanField(body.prerelease)
  }
  if (body.draft !== undefined) {
    release.draft = booleanField(body.draft)
    release.published_at = release.draft ? null : ProofDate
  }
  return release
}

async function handleReleasesAPI(
  context: GuidedProofContext,
  request: IncomingMessage,
  response: ServerResponse,
  url: URL,
  path: string,
  audit: IProofAudit
): Promise<boolean> {
  const repositoryPath = `/repos/${ProofOwner}/${ProofRepository}`
  if (path === `${repositoryPath}/releases`) {
    audit.route = 'api-releases'
    if (!requireMethod(request, response, ['GET', 'POST'])) {
      return true
    }
    if (request.method === 'POST') {
      requireOnlyQuery(url, [])
      sendJSON(
        response,
        201,
        serializeRelease(await createRelease(context, request))
      )
      return true
    }
    requireOnlyQuery(url, ['per_page', 'page'])
    const perPage = boundedIntegerQuery(url, 'per_page', 1, 30, 30)
    const page = boundedIntegerQuery(url, 'page', 1, 10, 1)
    sendJSON(
      response,
      200,
      page === 1 ? context.releases.slice(0, perPage).map(serializeRelease) : []
    )
    return true
  }
  const exactRelease = new RegExp(
    `^${repositoryPath}/releases/([1-9][0-9]*)$`
  ).exec(path)
  if (exactRelease !== null) {
    audit.route = 'api-release-detail'
    if (!requireMethod(request, response, ['GET', 'PATCH', 'DELETE'])) {
      return true
    }
    requireOnlyQuery(url, [])
    const releaseId = Number.parseInt(exactRelease[1], 10)
    const release = releaseById(context, releaseId)
    if (request.method === 'DELETE') {
      if ((await readBody(request)).length !== 0) {
        throw new ProofRequestError(400, 'unexpected-request-body')
      }
      context.releases.splice(context.releases.indexOf(release), 1)
      sendNoContent(response)
      return true
    }
    if (request.method === 'PATCH') {
      await updateRelease(request, release)
    }
    sendJSON(response, 200, serializeRelease(release))
    return true
  }
  const releaseAssets = new RegExp(
    `^${repositoryPath}/releases/([1-9][0-9]*)/assets$`
  ).exec(path)
  if (releaseAssets !== null) {
    audit.route = 'api-release-assets'
    if (!requireMethod(request, response, ['GET'])) {
      return true
    }
    requireOnlyQuery(url, ['per_page', 'page'])
    const perPage = boundedIntegerQuery(url, 'per_page', 1, 100, 100)
    const page = boundedIntegerQuery(url, 'page', 1, 5, 1)
    const release = releaseById(context, Number.parseInt(releaseAssets[1], 10))
    sendJSON(
      response,
      200,
      page === 1
        ? release.assets.slice(0, perPage).map(serializeReleaseAsset)
        : []
    )
    return true
  }
  const exactAsset = new RegExp(
    `^${repositoryPath}/releases/assets/([1-9][0-9]*)$`
  ).exec(path)
  if (exactAsset !== null) {
    audit.route = 'api-release-asset'
    if (!requireMethod(request, response, ['GET', 'DELETE'])) {
      return true
    }
    requireOnlyQuery(url, [])
    const { release, asset } = releaseAssetById(
      context,
      Number.parseInt(exactAsset[1], 10)
    )
    if (request.method === 'DELETE') {
      if ((await readBody(request)).length !== 0) {
        throw new ProofRequestError(400, 'unexpected-request-body')
      }
      release.assets.splice(release.assets.indexOf(asset), 1)
      sendNoContent(response)
      return true
    }
    const accept = request.headers.accept ?? ''
    if (accept.toLowerCase().includes('application/octet-stream')) {
      sendBytes(response, 200, asset.content_type, asset.bytes, {
        'Content-Disposition': `attachment; filename="${asset.name}"`,
      })
      return true
    }
    sendJSON(response, 200, serializeReleaseAsset(asset))
    return true
  }
  return false
}

async function handleReleaseUpload(
  context: GuidedProofContext,
  request: IncomingMessage,
  response: ServerResponse,
  url: URL,
  audit: IProofAudit
): Promise<boolean> {
  const upload = new RegExp(
    `^/api/uploads/repos/${ProofOwner}/${ProofRepository}/releases/([1-9][0-9]*)/assets$`
  ).exec(url.pathname)
  if (upload === null) {
    return false
  }
  audit.route = 'api-release-asset-upload'
  if (!requireMethod(request, response, ['POST'])) {
    return true
  }
  requireOnlyQuery(url, ['name', 'label'])
  const name = boundedString(url.searchParams.get('name'), 255)
  if (/[<>:"/\\|?*]/.test(name) || name === '.' || name === '..') {
    throw new ProofRequestError(400, 'invalid-asset-name')
  }
  const labelValue = url.searchParams.get('label')
  const label =
    labelValue === null ? null : boundedString(labelValue, 255, true)
  const contentType = boundedString(
    request.headers['content-type'] ?? 'application/octet-stream',
    255
  )
  const bytes = await readBody(request)
  if (bytes.length === 0) {
    throw new ProofRequestError(400, 'empty-asset')
  }
  const release = releaseById(context, Number.parseInt(upload[1], 10))
  const storedAssetBytes = context.releases.reduce(
    (total, item) =>
      total + item.assets.reduce((sum, asset) => sum + asset.bytes.length, 0),
    0
  )
  if (
    release.assets.length >= ProofReleaseAssetMaximumCount ||
    storedAssetBytes + bytes.length > ProofReleaseAssetStoredMaximumBytes
  ) {
    throw new ProofRequestError(409, 'release-asset-limit-reached')
  }
  const allIds = context.releases.flatMap(item =>
    item.assets.map(asset => asset.id)
  )
  const asset: IProofReleaseAsset = {
    id: Math.max(1901, ...allIds) + 1,
    name,
    label,
    state: 'uploaded',
    content_type: contentType,
    size: bytes.length,
    download_count: 0,
    created_at: ProofDate,
    updated_at: ProofDate,
    digest: sha256(bytes),
    bytes,
  }
  release.assets.push(asset)
  sendJSON(response, 201, serializeReleaseAsset(asset))
  return true
}

function actionsArtifactPayload(context: GuidedProofContext): unknown {
  return {
    id: 7301,
    name: 'guided-proof-artifact',
    size_in_bytes: ProofArtifactBytes.length,
    expired: false,
    created_at: ProofDate,
    expires_at: '2026-10-11T12:00:00Z',
    updated_at: ProofDate,
    digest: sha256(ProofArtifactBytes),
    workflow_run: {
      id: 7001,
      head_branch: ProofBranch,
      head_sha: context.options.repository.headSha,
    },
  }
}

async function handleActionsAPI(
  context: GuidedProofContext,
  request: IncomingMessage,
  response: ServerResponse,
  url: URL,
  path: string,
  audit: IProofAudit
): Promise<boolean> {
  const repositoryPath = `/repos/${ProofOwner}/${ProofRepository}`
  if (
    path === `${repositoryPath}/contents/.github/workflows/guided-proof.yml`
  ) {
    audit.route = 'api-actions-workflow-source'
    if (!requireMethod(request, response, ['GET'])) {
      return true
    }
    requireOnlyQuery(url, ['ref'])
    const reference = url.searchParams.get('ref')
    if (reference !== null && reference !== ProofBranch) {
      throw new ProofRequestError(404, 'workflow-reference-not-found')
    }
    sendText(response, 200, ProofWorkflowYAML)
    return true
  }
  if (path === `${repositoryPath}/actions/workflows`) {
    audit.route = 'api-actions-workflows'
    if (!requireMethod(request, response, ['GET'])) {
      return true
    }
    requireOnlyQuery(url, ['per_page'])
    boundedIntegerQuery(url, 'per_page', 1, 100, 100)
    sendJSON(response, 200, {
      total_count: 1,
      workflows: [workflowPayload(context)],
    })
    return true
  }
  const workflowRuns = new RegExp(
    `^${repositoryPath}/actions/workflows/([1-9][0-9]*)/runs$`
  ).exec(path)
  if (path === `${repositoryPath}/actions/runs` || workflowRuns !== null) {
    audit.route = 'api-actions-runs'
    if (!requireMethod(request, response, ['GET'])) {
      return true
    }
    if (workflowRuns !== null && Number.parseInt(workflowRuns[1], 10) !== 700) {
      throw new ProofRequestError(404, 'workflow-not-found')
    }
    requireOnlyQuery(url, [
      'per_page',
      'branch',
      'event',
      'status',
      'check_suite_id',
    ])
    boundedIntegerQuery(url, 'per_page', 1, 100, 50)
    const branch = url.searchParams.get('branch')
    const status = url.searchParams.get('status')
    const matching =
      (branch === null || branch === ProofBranch) &&
      (status === null || status === 'completed' || status === 'success')
    sendJSON(response, 200, {
      total_count: matching ? 1 : 0,
      workflow_runs: matching ? [workflowRunPayload(context)] : [],
    })
    return true
  }
  const runJobs = new RegExp(
    `^${repositoryPath}/actions/runs/([1-9][0-9]*)/jobs$`
  ).exec(path)
  if (runJobs !== null) {
    audit.route = 'api-actions-jobs'
    if (!requireMethod(request, response, ['GET'])) {
      return true
    }
    requireOnlyQuery(url, [])
    if (Number.parseInt(runJobs[1], 10) !== 7001) {
      throw new ProofRequestError(404, 'run-not-found')
    }
    sendJSON(response, 200, {
      total_count: 1,
      jobs: [workflowJobPayload(context)],
    })
    return true
  }
  const runArtifacts = new RegExp(
    `^${repositoryPath}/actions/runs/([1-9][0-9]*)/artifacts$`
  ).exec(path)
  if (runArtifacts !== null) {
    audit.route = 'api-actions-artifacts'
    if (!requireMethod(request, response, ['GET'])) {
      return true
    }
    requireOnlyQuery(url, ['per_page', 'page'])
    boundedIntegerQuery(url, 'per_page', 1, 100, 100)
    const page = boundedIntegerQuery(url, 'page', 1, 10, 1)
    if (Number.parseInt(runArtifacts[1], 10) !== 7001) {
      throw new ProofRequestError(404, 'run-not-found')
    }
    sendJSON(response, 200, {
      total_count: 1,
      artifacts: page === 1 ? [actionsArtifactPayload(context)] : [],
    })
    return true
  }
  const artifactDownload = new RegExp(
    `^${repositoryPath}/actions/artifacts/([1-9][0-9]*)/zip$`
  ).exec(path)
  if (artifactDownload !== null) {
    audit.route = 'api-actions-artifact-download'
    if (!requireMethod(request, response, ['GET'])) {
      return true
    }
    requireOnlyQuery(url, [])
    if (Number.parseInt(artifactDownload[1], 10) !== 7301) {
      throw new ProofRequestError(404, 'artifact-not-found')
    }
    sendBytes(response, 200, 'application/zip', ProofArtifactBytes, {
      'Content-Disposition': 'attachment; filename="guided-proof-artifact.zip"',
    })
    return true
  }
  const jobLog = new RegExp(
    `^${repositoryPath}/actions/jobs/([1-9][0-9]*)/logs$`
  ).exec(path)
  if (jobLog !== null) {
    audit.route = 'api-actions-job-log'
    if (!requireMethod(request, response, ['GET'])) {
      return true
    }
    requireOnlyQuery(url, [])
    if (Number.parseInt(jobLog[1], 10) !== 7101) {
      throw new ProofRequestError(404, 'job-not-found')
    }
    sendText(
      response,
      200,
      [
        '2026-07-13T12:00:00Z Guided proof build completed',
        '2026-07-13T12:00:01Z All bounded checks passed',
        '',
      ].join('\n'),
      {
        'Content-Disposition': 'attachment; filename="guided-proof-job.txt"',
      }
    )
    return true
  }
  const branchRules = new RegExp(
    `^${repositoryPath}/rules/branches/(.+)$`
  ).exec(path)
  if (branchRules !== null) {
    audit.route = 'api-actions-branch-rules'
    if (!requireMethod(request, response, ['GET'])) {
      return true
    }
    requireOnlyQuery(url, ['per_page', 'page'])
    if (safeDecodeURIComponent(branchRules[1]) !== ProofBranch) {
      throw new ProofRequestError(404, 'branch-not-found')
    }
    const page = boundedIntegerQuery(url, 'page', 1, 5, 1)
    boundedIntegerQuery(url, 'per_page', 1, 100, 100)
    sendJSON(
      response,
      200,
      page === 1
        ? [
            {
              ruleset_id: 9301,
              type: 'required_status_checks',
              ruleset_source_type: 'Repository',
              ruleset_source: `${ProofOwner}/${ProofRepository}`,
              parameters: {
                required_status_checks: [{ context: 'Guided proof CI' }],
              },
            },
            {
              ruleset_id: 9301,
              type: 'pull_request',
              ruleset_source_type: 'Repository',
              ruleset_source: `${ProofOwner}/${ProofRepository}`,
              parameters: { required_approving_review_count: 1 },
            },
          ]
        : []
    )
    return true
  }
  const attestation = new RegExp(`^${repositoryPath}/attestations/(.+)$`).exec(
    path
  )
  if (attestation !== null) {
    audit.route = 'api-actions-attestation'
    if (!requireMethod(request, response, ['GET'])) {
      return true
    }
    requireOnlyQuery(url, ['per_page'])
    if (boundedIntegerQuery(url, 'per_page', 1, 1, 1) !== 1) {
      throw new ProofRequestError(400, 'invalid-query')
    }
    const digest = safeDecodeURIComponent(attestation[1]).toLowerCase()
    sendJSON(response, 200, {
      attestations:
        digest === sha256(ProofArtifactBytes)
          ? [
              {
                bundle: {
                  mediaType: 'application/vnd.dev.sigstore.bundle+json',
                },
              },
            ]
          : [],
    })
    return true
  }
  const pushControl = new RegExp(
    `^${repositoryPath}/branches/(.+)/push_control$`
  ).exec(path)
  if (pushControl !== null) {
    audit.route = 'api-branch-push-control'
    if (!requireMethod(request, response, ['GET'])) {
      return true
    }
    requireOnlyQuery(url, [])
    if (safeDecodeURIComponent(pushControl[1]) !== ProofBranch) {
      throw new ProofRequestError(404, 'branch-not-found')
    }
    sendJSON(response, 200, {
      pattern: ProofBranch,
      required_signatures: false,
      required_status_checks: ['Guided proof CI'],
      required_approving_review_count: 1,
      required_linear_history: true,
      allow_actor: true,
      allow_deletions: false,
      allow_force_pushes: false,
    })
    return true
  }
  if (path === `${repositoryPath}/branches`) {
    audit.route = 'api-protected-branches'
    if (!requireMethod(request, response, ['GET'])) {
      return true
    }
    requireOnlyQuery(url, ['protected'])
    if ((url.searchParams.get('protected') ?? 'true') !== 'true') {
      throw new ProofRequestError(400, 'invalid-query')
    }
    sendJSON(response, 200, [{ name: ProofBranch, protected: true }])
    return true
  }
  if (path === `${repositoryPath}/rulesets`) {
    audit.route = 'api-rulesets'
    if (!requireMethod(request, response, ['GET'])) {
      return true
    }
    requireOnlyQuery(url, [])
    sendJSON(response, 200, [{ id: 9301 }])
    return true
  }
  if (path === `${repositoryPath}/rulesets/9301`) {
    audit.route = 'api-ruleset'
    if (!requireMethod(request, response, ['GET'])) {
      return true
    }
    requireOnlyQuery(url, [])
    sendJSON(response, 200, {
      id: 9301,
      current_user_can_bypass: 'never',
    })
    return true
  }
  const workflowStateMutation = new RegExp(
    `^${repositoryPath}/actions/workflows/700/(enable|disable)$`
  ).exec(path)
  if (workflowStateMutation !== null) {
    audit.route = 'api-actions-local-mutation'
    if (!requireMethod(request, response, ['PUT'])) {
      return true
    }
    requireOnlyQuery(url, [])
    if ((await readBody(request)).length !== 0) {
      throw new ProofRequestError(400, 'unexpected-request-body')
    }
    context.workflowEnabled = workflowStateMutation[1] === 'enable'
    sendNoContent(response)
    return true
  }
  if (path === `${repositoryPath}/actions/workflows/700/dispatches`) {
    audit.route = 'api-actions-workflow-dispatch'
    if (!requireMethod(request, response, ['POST'])) {
      return true
    }
    requireOnlyQuery(url, [])
    const body = await readJSONObject(request)
    requireOnlyFields(body, ['ref', 'inputs'])
    if (body.ref !== ProofBranch) {
      throw new ProofRequestError(422, 'unknown-workflow-reference')
    }
    if (
      typeof body.inputs !== 'object' ||
      body.inputs === null ||
      Array.isArray(body.inputs)
    ) {
      throw new ProofRequestError(422, 'invalid-workflow-inputs')
    }
    const inputs = body.inputs as Record<string, unknown>
    if (Object.keys(inputs).length > 10) {
      throw new ProofRequestError(422, 'too-many-workflow-inputs')
    }
    for (const [name, value] of Object.entries(inputs)) {
      if (!/^[A-Za-z_][A-Za-z0-9_-]{0,63}$/.test(name)) {
        throw new ProofRequestError(422, 'invalid-workflow-input-name')
      }
      boundedString(value, 1024, true)
    }
    sendNoContent(response)
    return true
  }
  const actionMutation = new RegExp(
    `^${repositoryPath}/actions/(?:runs/7001/(?:rerun|rerun-failed-jobs|cancel|force-cancel)|jobs/7101/rerun)$`
  ).exec(path)
  if (actionMutation !== null) {
    audit.route = 'api-actions-local-mutation'
    if (!requireMethod(request, response, ['POST'])) {
      return true
    }
    requireOnlyQuery(url, [])
    if ((await readBody(request)).length !== 0) {
      throw new ProofRequestError(400, 'unexpected-request-body')
    }
    sendNoContent(response)
    return true
  }
  return false
}

async function dispatchGuidedProofRequest(
  context: GuidedProofContext,
  request: IncomingMessage,
  response: ServerResponse,
  audit: IProofAudit
): Promise<void> {
  const rawURL = request.url
  if (rawURL === undefined || rawURL.length === 0 || rawURL.length > 8192) {
    audit.route = 'rejected-request-target'
    throw new ProofRequestError(400, 'invalid-request-target')
  }
  const rawPath = rawURL.split('?', 1)[0]
  if (
    !rawURL.startsWith('/') ||
    rawURL.startsWith('//') ||
    rawPath.includes('\\') ||
    rawPath.includes('//') ||
    /[\u0000-\u001f\u007f#]/.test(rawPath) ||
    /(?:^|\/)(?:\.|%2e)(?:\.|%2e)?(?:\/|$)/i.test(rawPath) ||
    /%(?:2f|5c)/i.test(rawPath)
  ) {
    audit.route = 'rejected-request-target'
    throw new ProofRequestError(400, 'non-canonical-request-target')
  }
  const requestHost = request.headers.host?.toLowerCase()
  if (requestHost !== context.options.expectedHost.toLowerCase()) {
    audit.route = 'rejected-host'
    throw new ProofRequestError(421, 'unexpected-host')
  }
  validateRequestBodyEnvelope(request)
  let url: URL
  try {
    url = new URL(rawURL, `${context.ready.origin}/`)
  } catch {
    audit.route = 'rejected-request-target'
    throw new ProofRequestError(400, 'invalid-request-target')
  }
  const configuredOrigin = new URL(`${context.ready.origin}/`)
  if (
    url.protocol !== configuredOrigin.protocol ||
    url.host.toLowerCase() !== configuredOrigin.host.toLowerCase() ||
    url.username !== '' ||
    url.password !== '' ||
    url.hash !== ''
  ) {
    audit.route = 'rejected-origin'
    throw new ProofRequestError(421, 'unexpected-origin')
  }
  audit.account = context.classifyAuthorization(request.headers.authorization)

  if (url.pathname.startsWith(ProofGitPath)) {
    await handleGitRequest(context, request, response, url, audit)
    return
  }

  const isPublicSyntheticAvatar = [
    `${ProofAPIPrefix}/enterprise/avatars/proof-a`,
    `${ProofAPIPrefix}/enterprise/avatars/proof-b`,
  ].includes(url.pathname)
  if (
    audit.account !== 'proof-a' &&
    audit.account !== 'proof-b' &&
    !isPublicSyntheticAvatar
  ) {
    audit.route = 'api-authentication'
    sendAuthenticationRequired(response)
    return
  }

  if (url.pathname.startsWith('/api/uploads/')) {
    if (await handleReleaseUpload(context, request, response, url, audit)) {
      return
    }
    audit.route = 'rejected-upload-route'
    sendJSON(response, 404, { message: 'Unknown guided proof upload route.' })
    return
  }

  if (
    url.pathname !== ProofAPIPrefix &&
    !url.pathname.startsWith(`${ProofAPIPrefix}/`)
  ) {
    audit.route = 'rejected-route'
    sendJSON(response, 404, { message: 'Unknown guided proof route.' })
    return
  }
  const apiPath = url.pathname.slice(ProofAPIPrefix.length) || '/'
  if (
    (await handleAccountAndRepositoryAPI(
      context,
      request,
      response,
      url,
      apiPath,
      audit
    )) ||
    (await handleIssuesAPI(context, request, response, url, apiPath, audit)) ||
    (await handleReleasesAPI(
      context,
      request,
      response,
      url,
      apiPath,
      audit
    )) ||
    (await handleActionsAPI(context, request, response, url, apiPath, audit))
  ) {
    return
  }
  audit.route = 'rejected-api-route'
  sendJSON(response, 404, { message: 'Unknown guided proof API route.' })
}

export interface IGuidedProofHandlerFixture {
  readonly ready: IGuidedProofReady
  readonly handler: GuidedProofRequestHandler
  flushLedger(): Promise<void>
  waitForRequests(): Promise<void>
  stopUploadPacks(): Promise<void>
}

/** Build the request handler separately so focused tests can use HTTP locally. */
export function createGuidedProofHandler(
  options: IGuidedProofContextOptions
): IGuidedProofHandlerFixture {
  const context = new GuidedProofContext(options)
  const handler: GuidedProofRequestHandler = (request, response) => {
    const work = (async () => {
      const audit: IProofAudit = {
        route: 'rejected-request',
        account: 'anonymous',
      }
      let finalStatus = 500
      try {
        await dispatchGuidedProofRequest(context, request, response, audit)
        finalStatus = response.statusCode
      } catch (error) {
        finalStatus =
          error instanceof ProofPayloadTooLargeError
            ? 413
            : error instanceof ProofRequestError
            ? error.status
            : 500
        if (!response.headersSent && !response.destroyed) {
          sendJSON(response, finalStatus, {
            message:
              error instanceof ProofPayloadTooLargeError
                ? 'The guided proof request is too large.'
                : error instanceof ProofRequestError
                ? `Guided proof request rejected: ${error.code}.`
                : 'The guided proof fixture could not complete the request.',
          })
        } else if (!response.destroyed) {
          response.end()
        }
      } finally {
        context.recordEvent(
          request.method ?? 'UNKNOWN',
          audit.route,
          audit.account,
          finalStatus
        )
      }
    })()
    context.trackRequest(work)
  }
  return {
    ready: context.ready,
    handler,
    flushLedger: async () => await context.flushLedger(),
    waitForRequests: async () => await context.waitForRequests(),
    stopUploadPacks: async () => await context.stopUploadPacks(),
  }
}

async function readTLSMaterial(path: string): Promise<Buffer> {
  if (!isAbsolute(path)) {
    throw new Error('TLS material paths must be absolute.')
  }
  const before = await lstat(path)
  if (
    !before.isFile() ||
    before.isSymbolicLink() ||
    before.size < 1 ||
    before.size > ProofTLSFileMaximumBytes
  ) {
    throw new Error('TLS material must be a bounded regular file.')
  }
  const handle = await open(path, 'r')
  try {
    const opened = await handle.stat()
    if (
      !opened.isFile() ||
      opened.size !== before.size ||
      opened.dev !== before.dev ||
      opened.ino !== before.ino
    ) {
      throw new Error('TLS material changed before it could be opened.')
    }
    const bytes = await handle.readFile()
    const after = await handle.stat()
    if (
      bytes.length !== opened.size ||
      after.size !== opened.size ||
      after.dev !== opened.dev ||
      after.ino !== opened.ino
    ) {
      throw new Error('TLS material changed while it was being read.')
    }
    return bytes
  } finally {
    await handle.close()
  }
}

export interface IStartGuidedProofFixtureOptions {
  readonly root: string
  readonly certificatePath: string
  readonly keyPath: string
  readonly port: number
  readonly originHost?: '127.0.0.1' | 'localhost'
  readonly tokenA: string
  readonly tokenB: string
}

export interface IRunningGuidedProofFixture {
  readonly ready: IGuidedProofReady
  readonly server: HTTPSServer
  close(): Promise<void>
}

/** Start the production HTTPS fixture on the IPv4 loopback interface only. */
export async function startGuidedProofFixture(
  options: IStartGuidedProofFixtureOptions
): Promise<IRunningGuidedProofFixture> {
  if (
    !Number.isSafeInteger(options.port) ||
    options.port < 1 ||
    options.port > 65_535
  ) {
    throw new Error('The guided proof port must be between 1 and 65535.')
  }
  const originHost = options.originHost ?? '127.0.0.1'
  if (originHost !== '127.0.0.1' && originHost !== 'localhost') {
    throw new Error('The guided proof origin must be loopback-only.')
  }
  const tokenA = validateToken(options.tokenA, 'Proof account A token')
  const tokenB = validateToken(options.tokenB, 'Proof account B token')
  if (tokenA === tokenB) {
    throw new Error('The two guided proof tokens must be distinct.')
  }
  const [certificate, key] = await Promise.all([
    readTLSMaterial(options.certificatePath),
    readTLSMaterial(options.keyPath),
  ])
  const repository = await createGuidedProofRepository(options.root)
  const origin = new URL(`https://${originHost}:${options.port}/`)
  const fixture = createGuidedProofHandler({
    repository,
    origin: origin.toString(),
    expectedHost: origin.host,
    tokenA,
    tokenB,
  })
  const server = createHTTPSServer({ cert: certificate, key }, fixture.handler)
  await new Promise<void>((resolvePromise, reject) => {
    const onError = () =>
      reject(new Error('The guided proof port is unavailable.'))
    server.once('error', onError)
    server.listen(options.port, ProofBindAddress, () => {
      server.off('error', onError)
      resolvePromise()
    })
  })
  const closeServer = async (): Promise<void> => {
    if (!server.listening) {
      return
    }
    await new Promise<void>(resolvePromise => {
      server.close(() => resolvePromise())
      server.closeAllConnections()
    })
  }
  try {
    await writeFile(
      repository.readyPath,
      `${JSON.stringify(fixture.ready, null, 2)}\n`,
      { encoding: 'utf8', flag: 'wx' }
    )
  } catch {
    await fixture.stopUploadPacks().catch(() => undefined)
    await closeServer()
    throw new Error('The guided proof ready file could not be published.')
  }
  server.on('error', () => undefined)
  let closePromise: Promise<void> | null = null
  return {
    ready: fixture.ready,
    server,
    close: async () => {
      if (closePromise !== null) {
        await closePromise
        return
      }
      closePromise = (async () => {
        const serverClosed = closeServer()
        await fixture.stopUploadPacks()
        await serverClosed
        await fixture.waitForRequests()
        await fixture.stopUploadPacks()
        await fixture.flushLedger()
      })()
      await closePromise
    },
  }
}

interface ICLIArguments {
  readonly root: string
  readonly certificatePath: string
  readonly keyPath: string
  readonly port: number
  readonly originHost: '127.0.0.1' | 'localhost'
  readonly tokenA: string
  readonly tokenB: string
}

function usage(): string {
  return [
    'Usage: yarn proof:fixture --root <owned-empty-root> --cert <cert.pem> --key <key.pem> --port <port> [--origin-host localhost]',
    '',
    'Set GUIDED_PROOF_TOKEN_A and GUIDED_PROOF_TOKEN_B in the environment.',
    'Token values are accepted but are never included in ready output or the event ledger.',
  ].join('\n')
}

export function parseGuidedProofCLIArguments(
  argv: ReadonlyArray<string>,
  environment: Readonly<Record<string, string | undefined>> = process.env
): ICLIArguments | null {
  if (argv.length === 1 && argv[0] === '--help') {
    return null
  }
  const allowed = new Set([
    '--root',
    '--cert',
    '--key',
    '--port',
    '--origin-host',
  ])
  const values = new Map<string, string>()
  for (let index = 0; index < argv.length; index += 2) {
    const name = argv[index]
    const value = argv[index + 1]
    if (
      !allowed.has(name) ||
      value === undefined ||
      value.startsWith('--') ||
      values.has(name)
    ) {
      throw new Error('The guided proof command line is invalid.')
    }
    values.set(name, value)
  }
  const root = values.get('--root')
  const certificatePath = values.get('--cert')
  const keyPath = values.get('--key')
  const portText = values.get('--port')
  const tokenA = environment.GUIDED_PROOF_TOKEN_A
  const tokenB = environment.GUIDED_PROOF_TOKEN_B
  if (
    root === undefined ||
    certificatePath === undefined ||
    keyPath === undefined ||
    portText === undefined ||
    tokenA === undefined ||
    tokenB === undefined ||
    !/^[0-9]+$/.test(portText)
  ) {
    throw new Error('Required guided proof options are missing.')
  }
  const originHost = values.get('--origin-host') ?? '127.0.0.1'
  if (originHost !== '127.0.0.1' && originHost !== 'localhost') {
    throw new Error('The guided proof origin host must be loopback-only.')
  }
  return {
    root,
    certificatePath,
    keyPath,
    port: Number.parseInt(portText, 10),
    originHost,
    tokenA,
    tokenB,
  }
}

async function main(): Promise<void> {
  let fixture: IRunningGuidedProofFixture | null = null
  try {
    const options = parseGuidedProofCLIArguments(process.argv.slice(2))
    if (options === null) {
      process.stdout.write(`${usage()}\n`)
      return
    }
    fixture = await startGuidedProofFixture(options)
    process.stdout.write(`${JSON.stringify(fixture.ready)}\n`)
    const close = async () => {
      try {
        await fixture?.close()
        process.exitCode = 0
      } catch {
        process.exitCode = 1
      }
    }
    process.once('SIGINT', () => void close())
    process.once('SIGTERM', () => void close())
  } catch {
    if (fixture !== null) {
      await fixture.close().catch(() => undefined)
    }
    process.stderr.write('The guided proof fixture could not start safely.\n')
    process.exitCode = 1
  }
}

if (require.main === module) {
  void main()
}
