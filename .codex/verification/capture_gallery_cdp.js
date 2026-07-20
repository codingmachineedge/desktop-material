#!/usr/bin/env node
'use strict'

/**
 * Gallery screenshot driver (CDP attach mode).
 *
 * Connects to the already-running production build (launched on the hidden
 * Win32 desktop with --remote-debugging-port), seeds the deterministic
 * provider profile, drives surfaces entirely through the renderer (DOM plus
 * ipcRenderer-emitted menu events), fixes the capture viewport with CDP
 * device metrics, and writes candidate PNGs below a caller-owned Temp run.
 * Promotion into docs/assets/screenshots is a separate reviewed step.
 *
 * Usage:
 *   node .codex/verification/capture_gallery_cdp.js \
 *     --run-root %TEMP%\desktop-material-p0-ui-... [--port 9337] \
 *     --scenes seed,dump --out %TEMP%\desktop-material-p0-ui-...\captures\gallery
 *   node ... --fixture-path C:\DesktopMaterialEvidence\fixture \
 *     --scenes seed,repository-tools
 *   node ... --probe "expression"
 *   node ... --list
 */

const fs = require('fs')
const crypto = require('crypto')
const { execFileSync } = require('child_process')
const http = require('http')
const os = require('os')
const path = require('path')
const WebSocket = require('ws')

const repoRoot = path.resolve(__dirname, '..', '..')

function fail(message) {
  throw new Error(message)
}

function parseArguments(argv) {
  const values = new Map()
  for (let index = 0; index < argv.length; index += 2) {
    const name = argv[index]
    const value = argv[index + 1]
    if (!name?.startsWith('--') || value === undefined) {
      fail(`Invalid argument near ${name ?? '<end>'}.`)
    }
    values.set(name.slice(2), value)
  }
  return values
}

const args = parseArguments(process.argv.slice(2))
const port = Number(args.get('port') ?? '9337')
const requestedOutDir = args.get('out')
const outDir =
  requestedOutDir === undefined ? null : path.resolve(repoRoot, requestedOutDir)
const runRoot = args.get('run-root')
const ready = runRoot
  ? JSON.parse(
      fs.readFileSync(path.join(runRoot, 'provider', 'ready.json'), 'utf8')
    )
  : null
const fixturePath = args.get('fixture-path')
  ? path.resolve(args.get('fixture-path'))
  : runRoot
  ? path.join(runRoot, 'fixture')
  : null
const fixtureSourcePath = runRoot ? path.join(runRoot, 'git-source') : null
const providerRequestLog = runRoot
  ? path.join(runRoot, 'provider', 'requests.jsonl')
  : null

function readOwnedOllamaFixture(requestedRunRoot) {
  if (requestedRunRoot === undefined) {
    return null
  }

  let tempRoot
  let ownedRunRoot
  try {
    tempRoot = fs.realpathSync.native(os.tmpdir())
    ownedRunRoot = fs.realpathSync.native(path.resolve(requestedRunRoot))
  } catch {
    fail('The owned Ollama fixture run root could not be resolved.')
  }

  const rootName = path.basename(ownedRunRoot)
  if (
    path.dirname(ownedRunRoot).toLowerCase() !== tempRoot.toLowerCase() ||
    !/^desktop-material-ollama-[A-Za-z0-9][A-Za-z0-9._-]{5,120}$/.test(rootName)
  ) {
    fail(
      'The Ollama fixture must be a direct Temp child named desktop-material-ollama-*.'
    )
  }

  const ownedDirectory = path.join(ownedRunRoot, 'ollama')
  const readyPath = path.join(ownedDirectory, 'ready.json')
  for (const [candidate, kind] of [
    [ownedRunRoot, 'directory'],
    [ownedDirectory, 'directory'],
    [readyPath, 'file'],
  ]) {
    let item
    try {
      item = fs.lstatSync(candidate)
    } catch {
      fail(`The owned Ollama ${kind} is missing.`)
    }
    if (
      item.isSymbolicLink() ||
      (kind === 'directory' ? !item.isDirectory() : !item.isFile())
    ) {
      fail(`The owned Ollama ${kind} failed its real-path contract.`)
    }
  }
  if (
    fs.realpathSync.native(ownedDirectory).toLowerCase() !==
      ownedDirectory.toLowerCase() ||
    fs.realpathSync.native(readyPath).toLowerCase() !== readyPath.toLowerCase()
  ) {
    fail('The owned Ollama fixture contains a symlink or junction.')
  }

  let receipt
  let endpoint
  try {
    receipt = JSON.parse(fs.readFileSync(readyPath, 'utf8'))
    endpoint = new URL(receipt.endpoint)
  } catch {
    fail('The owned Ollama fixture readiness receipt is invalid.')
  }
  if (
    receipt.fixture !== 'desktop-material-ollama' ||
    receipt.protocolVersion !== 1 ||
    receipt.runRootName !== rootName ||
    receipt.bind !== '127.0.0.1' ||
    !Number.isSafeInteger(receipt.port) ||
    receipt.port < 1 ||
    receipt.port > 65535 ||
    !Number.isSafeInteger(receipt.pid) ||
    receipt.pid < 1 ||
    receipt.mutationLog !== 'ollama/mutations.jsonl' ||
    endpoint.protocol !== 'http:' ||
    endpoint.hostname !== '127.0.0.1' ||
    endpoint.port !== String(receipt.port) ||
    endpoint.pathname !== '/' ||
    endpoint.username !== '' ||
    endpoint.password !== '' ||
    endpoint.search !== '' ||
    endpoint.hash !== ''
  ) {
    fail('The owned Ollama fixture failed its loopback identity contract.')
  }

  return Object.freeze({
    runRoot: ownedRunRoot,
    endpoint: endpoint.origin,
    receipt: Object.freeze(receipt),
  })
}

const ollamaFixture = readOwnedOllamaFixture(args.get('ollama-run-root'))
if (ollamaFixture !== null && ready?.copilotEnabled !== true) {
  fail('The P0 provider must be started with Copilot enabled for Ollama proof.')
}
const ollamaProvider =
  ollamaFixture === null
    ? null
    : Object.freeze({
        id: 'material-ollama-fixture',
        name: 'Material Ollama',
        type: 'openai',
        integration: 'ollama',
        baseUrl: `${ollamaFixture.endpoint}/v1`,
        wireApi: 'completions',
        authKind: 'none',
        models: [],
      })

function assertOwnedDisposableFixture() {
  if (runRoot === undefined || fixturePath === null) {
    fail('Fixture mutation requires a named disposable Temp run root.')
  }

  let tempRoot
  let ownedRunRoot
  let ownedFixture
  try {
    tempRoot = fs.realpathSync.native(os.tmpdir())
    ownedRunRoot = fs.realpathSync.native(path.resolve(runRoot))
    ownedFixture = fs.realpathSync.native(fixturePath)
  } catch {
    fail('Disposable fixture ownership could not be verified.')
  }

  const relativeRunRoot = path.relative(tempRoot, ownedRunRoot)
  const namedRunRoot = path
    .basename(ownedRunRoot)
    .toLowerCase()
    .startsWith('desktop-material-p0-ui-')
  const runRootInsideTemp =
    relativeRunRoot !== '' &&
    relativeRunRoot !== '..' &&
    !relativeRunRoot.startsWith(`..${path.sep}`) &&
    !path.isAbsolute(relativeRunRoot)
  const relativeFixture = path.relative(ownedRunRoot, ownedFixture)
  if (
    !namedRunRoot ||
    !runRootInsideTemp ||
    relativeFixture.toLowerCase() !== 'fixture'
  ) {
    fail('Fixture mutation is outside the owned disposable Temp run root.')
  }
}

const AdvancedWorkflowLocalTagNames = Object.freeze([
  'preview-local',
  'v1.0.0',
  'v1.1.0',
])
const AdvancedWorkflowRemoteTagNames = Object.freeze([
  'archive-remote',
  'v1.0.0',
  'v1.1.0',
])
const AdvancedWorkflowGitTimeoutMs = 30_000
const AdvancedWorkflowGitMaxBufferBytes = 1024 * 1024
const AdvancedWorkflowGitNullDevice = 'NUL'
const AdvancedWorkflowGitRedirectEnvironmentNames = Object.freeze([
  'GIT_ALTERNATE_OBJECT_DIRECTORIES',
  'GIT_CEILING_DIRECTORIES',
  'GIT_COMMON_DIR',
  'GIT_DIR',
  'GIT_DISCOVERY_ACROSS_FILESYSTEM',
  'GIT_EXEC_PATH',
  'GIT_GLOB_PATHSPECS',
  'GIT_GRAFT_FILE',
  'GIT_ICASE_PATHSPECS',
  'GIT_IMPLICIT_WORK_TREE',
  'GIT_INDEX_FILE',
  'GIT_INTERNAL_SUPER_PREFIX',
  'GIT_LITERAL_PATHSPECS',
  'GIT_NAMESPACE',
  'GIT_NOGLOB_PATHSPECS',
  'GIT_NO_REPLACE_OBJECTS',
  'GIT_OBJECT_DIRECTORY',
  'GIT_PREFIX',
  'GIT_QUARANTINE_PATH',
  'GIT_REDIRECT_STDERR',
  'GIT_REDIRECT_STDIN',
  'GIT_REDIRECT_STDOUT',
  'GIT_REPLACE_REF_BASE',
  'GIT_SHALLOW_FILE',
  'GIT_SUPER_PREFIX',
  'GIT_TEMPLATE_DIR',
  'GIT_WORK_TREE',
])

function getAdvancedWorkflowGitEnvironment(overrides = {}) {
  const environment = { ...process.env, ...overrides }
  for (const key of Object.keys(environment)) {
    const normalizedKey = key.toUpperCase()
    if (
      /^GIT_CONFIG(?:_|$)/.test(normalizedKey) ||
      /^GIT_TRACE(?:2)?(?:_|$)/.test(normalizedKey) ||
      AdvancedWorkflowGitRedirectEnvironmentNames.includes(normalizedKey)
    ) {
      delete environment[key]
    }
  }

  return {
    ...environment,
    GIT_CONFIG_GLOBAL: AdvancedWorkflowGitNullDevice,
    GIT_CONFIG_SYSTEM: AdvancedWorkflowGitNullDevice,
    GIT_CONFIG_NOSYSTEM: '1',
  }
}

function runAdvancedWorkflowGit(repositoryPath, gitArguments, options = {}) {
  const { env: environmentOverrides, ...execOptions } = options
  return execFileSync(
    'git',
    [
      '-c',
      'tag.gpgSign=false',
      '-c',
      'push.gpgSign=false',
      '-c',
      `core.hooksPath=${AdvancedWorkflowGitNullDevice}`,
      '-C',
      repositoryPath,
      ...gitArguments,
    ],
    {
      encoding: 'utf8',
      windowsHide: true,
      stdio: 'pipe',
      ...execOptions,
      env: getAdvancedWorkflowGitEnvironment(environmentOverrides),
      timeout: AdvancedWorkflowGitTimeoutMs,
      maxBuffer: AdvancedWorkflowGitMaxBufferBytes,
    }
  ).trim()
}

function readAdvancedWorkflowTagRefs(repositoryPath) {
  const output = runAdvancedWorkflowGit(repositoryPath, [
    'for-each-ref',
    '--format=%(refname:strip=2)%00%(objectname)',
    'refs/tags',
  ])
  return new Map(
    output
      .split(/\r?\n/)
      .filter(line => line.length > 0)
      .map(line => {
        const [name, object] = line.split('\0')
        if (name === undefined || object === undefined) {
          fail('The advanced-workflow tag fixture returned a malformed ref.')
        }
        return [name, object.toLowerCase()]
      })
  )
}

/** Seed only the exact owned tag refs used by the advanced-workflows scene. */
function prepareAdvancedWorkflowTagFixture() {
  assertOwnedDisposableFixture()
  if (
    runRoot === undefined ||
    fixturePath === null ||
    ready === null ||
    typeof ready.owner !== 'string' ||
    typeof ready.repository !== 'string' ||
    typeof ready.defaultBranch !== 'string' ||
    typeof ready.featureBranch !== 'string' ||
    !/^[a-z0-9][a-z0-9._-]*$/i.test(ready.owner) ||
    !/^[a-z0-9][a-z0-9._-]*$/i.test(ready.repository)
  ) {
    fail('The advanced-workflow tag fixture lacks reviewed provider identity.')
  }

  let ownedRunRoot
  let ownedFixture
  let ownedBare
  try {
    ownedRunRoot = fs.realpathSync.native(path.resolve(runRoot))
    ownedFixture = fs.realpathSync.native(fixturePath)
    ownedBare = fs.realpathSync.native(
      path.join(
        ownedRunRoot,
        'git-http',
        ready.owner,
        `${ready.repository}.git`
      )
    )
  } catch {
    fail('The advanced-workflow local or bare fixture could not be resolved.')
  }

  const relativeFixture = path.relative(ownedRunRoot, ownedFixture)
  const relativeBare = path.relative(ownedRunRoot, ownedBare)
  const expectedBare = path.join(
    'git-http',
    ready.owner,
    `${ready.repository}.git`
  )
  const bareInsideRunRoot =
    relativeBare !== '' &&
    relativeBare !== '..' &&
    !relativeBare.startsWith(`..${path.sep}`) &&
    !path.isAbsolute(relativeBare)
  if (
    relativeFixture.toLowerCase() !== 'fixture' ||
    !bareInsideRunRoot ||
    relativeBare.toLowerCase() !== expectedBare.toLowerCase()
  ) {
    fail('The advanced-workflow tag fixture escaped its owned run root.')
  }
  if (
    runAdvancedWorkflowGit(ownedFixture, [
      'rev-parse',
      '--is-inside-work-tree',
    ]) !== 'true' ||
    runAdvancedWorkflowGit(ownedBare, ['rev-parse', '--is-bare-repository']) !==
      'true'
  ) {
    fail('The advanced-workflow tag fixture has an invalid Git repository.')
  }

  const defaultTarget = runAdvancedWorkflowGit(ownedFixture, [
    'rev-parse',
    '--verify',
    `refs/remotes/origin/${ready.defaultBranch}^{commit}`,
  ]).toLowerCase()
  const featureTarget = runAdvancedWorkflowGit(ownedFixture, [
    'rev-parse',
    '--verify',
    `refs/remotes/origin/${ready.featureBranch}^{commit}`,
  ]).toLowerCase()
  for (const object of [defaultTarget, featureTarget]) {
    if (!/^[0-9a-f]{40,64}$/.test(object)) {
      fail('The advanced-workflow tag target is not a reviewed Git object.')
    }
  }

  const allNames = [
    ...new Set([
      ...AdvancedWorkflowLocalTagNames,
      ...AdvancedWorkflowRemoteTagNames,
    ]),
  ]
  for (const name of allNames) {
    const tagRef = `refs/tags/${name}`
    runAdvancedWorkflowGit(ownedFixture, ['update-ref', '-d', tagRef])
    runAdvancedWorkflowGit(ownedBare, ['update-ref', '-d', tagRef])
  }

  const createAnnotatedTag = (name, target, message, taggerDate) => {
    runAdvancedWorkflowGit(
      ownedFixture,
      [
        'tag',
        '--no-sign',
        '--annotate',
        '--force',
        '--message',
        message,
        name,
        target,
      ],
      {
        env: {
          GIT_COMMITTER_NAME: 'Material Fixture',
          GIT_COMMITTER_EMAIL: 'material-fixture@example.invalid',
          GIT_COMMITTER_DATE: taggerDate,
        },
      }
    )
  }
  createAnnotatedTag(
    'v1.0.0',
    defaultTarget,
    'Synthetic baseline',
    '2026-07-13T10:13:00Z'
  )
  createAnnotatedTag(
    'v1.1.0',
    featureTarget,
    'Synthetic reviewed release',
    '2026-07-13T10:23:00Z'
  )
  createAnnotatedTag(
    'preview-local',
    featureTarget,
    'Synthetic local-only preview',
    '2026-07-13T10:24:00Z'
  )
  runAdvancedWorkflowGit(ownedFixture, [
    'update-ref',
    'refs/tags/archive-remote',
    featureTarget,
  ])
  runAdvancedWorkflowGit(ownedFixture, [
    'push',
    '--no-signed',
    '--no-verify',
    '--force',
    ownedBare,
    'refs/tags/v1.0.0:refs/tags/v1.0.0',
    'refs/tags/v1.1.0:refs/tags/v1.1.0',
    'refs/tags/archive-remote:refs/tags/archive-remote',
  ])
  runAdvancedWorkflowGit(ownedFixture, [
    'update-ref',
    '-d',
    'refs/tags/archive-remote',
  ])

  const local = readAdvancedWorkflowTagRefs(ownedFixture)
  const remote = readAdvancedWorkflowTagRefs(ownedBare)
  const localNames = [...local.keys()].sort()
  const remoteNames = [...remote.keys()].sort()
  const pushed = localNames.filter(
    name =>
      remote.get(name) !== undefined && remote.get(name) === local.get(name)
  )
  const localOnly = localNames.filter(name => !remote.has(name))
  const remoteOnly = remoteNames.filter(name => !local.has(name))
  const receipt = {
    fixture: relativeFixture,
    bare: relativeBare,
    local: localNames,
    remote: remoteNames,
    pushed,
    localOnly,
    remoteOnly,
  }
  if (
    JSON.stringify(localNames) !==
      JSON.stringify([...AdvancedWorkflowLocalTagNames].sort()) ||
    JSON.stringify(remoteNames) !==
      JSON.stringify([...AdvancedWorkflowRemoteTagNames].sort()) ||
    JSON.stringify(pushed) !== JSON.stringify(['v1.0.0', 'v1.1.0']) ||
    JSON.stringify(localOnly) !== JSON.stringify(['preview-local']) ||
    JSON.stringify(remoteOnly) !== JSON.stringify(['archive-remote'])
  ) {
    fail(
      `The advanced-workflow tag fixture has an invalid topology: ${JSON.stringify(
        receipt
      )}`
    )
  }
  process.stdout.write(`ADVANCED_TAG_FIXTURE ${JSON.stringify(receipt)}\n`)
  return receipt
}

const DefaultWidth = 1440
const DefaultHeight = 960
const CaptureWidth = Number(args.get('width') ?? DefaultWidth)
const CaptureHeight = Number(args.get('height') ?? DefaultHeight)
let currentViewportWidth = CaptureWidth
let currentViewportHeight = CaptureHeight

const CanonicalGalleryScenes = Object.freeze([
  'welcome',
  'complete-welcome',
  'seed',
  'workspace-changes',
  'history',
  'history-context-actions',
  'branches-sheet',
  'repositories-sheet',
  'settings',
  'settings-agent-access',
  'anchored-appearance',
  'settings-accounts',
  'settings-automation',
  'settings-history',
  'sparse-checkout',
  'gitignore-manager',
  'branch-rules',
  'repository-tools',
  'repository-tools-scroll',
  'error-notice',
  'responsive-overflow',
  'releases',
  'issues',
  'provider-triage',
  'api-explorer',
  'api-app-functions',
  'actions-runs',
  'actions-load-more',
  'actions-run-details',
  'actions-caches',
  'notification-center',
  'notification-bulk',
  'notification-github',
  'tab-search',
  'tab-arrange',
  'tab-style',
  'app-identity',
  'multi-window-menu',
  'toolbar-overflow',
  'scale-200',
  'history-power-tools',
  'remote-manager',
  'add-submodule',
  'logo-studio',
  'repository-folder-detection',
  'repository-submodule-management',
  'submodule-context',
  'stash-manager',
  'rebase-review',
  'pull-request-compose',
  'pull-request-open',
  'shallow-clone-dialog',
  'sparse-checkout-safe',
  'pull-all',
  'clone-fallback',
  'regex-builder',
  'history-deepen',
  'history-deepening',
  'actions-artifacts',
  'actions-artifact-download',
  'actions-artifact-page-two',
  'actions-sentinel',
  'actions-job-log',
  'actions-cancel',
  'actions-pending-deployments',
  'merge-all',
  'advanced-workflows',
  'cheap-lfs-preparing',
])

const CanonicalGalleryOutputs = Object.freeze([
  'material-welcome',
  'material-workspace-changes',
  'material-history',
  'material-history-context-actions',
  'material-branches-sheet',
  'material-repositories-sheet',
  'material-settings',
  'material-agent-access',
  'material-customization',
  'material-provider-accounts',
  'material-automation',
  'settings-history-manager',
  'material-sparse-checkout',
  'material-gitignore-manager',
  'material-effective-branch-rules',
  'material-repository-tools',
  'material-repository-tools-scroll',
  'material-error-notice',
  'material-responsive-overflow-fixed',
  'material-github-releases',
  'material-github-issues',
  'material-provider-triage',
  'material-github-api-explorer',
  'material-api-app-functions',
  'material-actions-pagination',
  'material-actions-pagination-headless',
  'material-actions-jobs-pagination',
  'material-actions-cache-manager',
  'material-notification-center',
  'material-notification-bulk-actions',
  'material-github-notifications',
  'material-tab-search',
  'material-tab-arrange',
  'material-tab-appearance-word',
  'material-app-identity-workspace',
  'material-multi-window-menu',
  'material-toolbar-overflow',
  'material-scale-200-autofit',
  'material-history-power-tools',
  'material-remote-manager',
  'add-submodule-dialog',
  'material-repository-logo-studio',
  'material-repository-folder-detection',
  'material-repository-submodule-management',
  'material-submodule-context',
  'material-stash-manager',
  'material-rebase-review',
  'material-native-pull-request',
  'material-create-pull-request',
  'material-shallow-clone',
  'material-shallow-clone-safe',
  'material-sparse-checkout-safe',
  'material-pull-all-account-fallback',
  'material-clone-account-fallback',
  'regex-builder',
  'material-history-deepen',
  'material-history-deepening',
  'material-actions-artifacts',
  'material-actions-artifact-download',
  'material-actions-artifact-page-two',
  'material-actions-artifacts-headless',
  'material-actions-sentinel-headless',
  'material-actions-job-log',
  'material-actions-cancel',
  'material-actions-pending-deployments',
  'material-branch-merge-all',
  'advanced-workflows',
  'material-cheap-lfs-preparing',
])

/**
 * Privacy-safe profile state used only while capturing the restored app
 * identity workspace. The scene restores the profile's prior identity after
 * the evidence frame so later canonical scenes keep their own clean baseline.
 */
const GalleryAppIdentity = Object.freeze({
  displayName: 'Material Studio',
  logo: 'sparkle',
  customLogoPath: null,
  logoColor: '#6750a4',
  logoShape: 'circle',
  showLogo: true,
  logoSize: 28,
  logoInset: 4,
  logoRotation: -6,
  logoBorder: 'strong',
  logoBorderColor: '#d0bcff',
  logoShadow: 'soft',
  brandGap: 12,
  fontSize: 14,
  fontWeight: 700,
  fontWidth: 'expanded',
  fontColor: '#21005d',
  highlightStyle: 'soft',
  highlightColor: '#eaddff',
  bold: true,
  characterSpacing: 0.5,
})
const capturedNames = []
const capturedHashes = new Map()

if (
  !Number.isInteger(CaptureWidth) ||
  CaptureWidth <= 0 ||
  !Number.isInteger(CaptureHeight) ||
  CaptureHeight <= 0
) {
  fail('Capture width and height must be positive integers.')
}

const SceneSurfaceSelector = [
  'dialog[open]',
  '[role="dialog"]',
  '#foldout-container',
  '#app-menu-foldout',
  '.material-context-menu-backdrop',
].join(', ')
const SceneErrorSelector = '.error-notice-stack .error-notice'
const SceneTooltipSelector = '.tooltip, [role="tooltip"]'

function getJSON(target) {
  return new Promise((resolve, reject) => {
    const request = http.get(
      { hostname: '127.0.0.1', port, path: target, timeout: 5000 },
      response => {
        const chunks = []
        response.on('data', chunk => chunks.push(chunk))
        response.on('end', () => {
          try {
            resolve(JSON.parse(Buffer.concat(chunks).toString('utf8')))
          } catch (error) {
            reject(error)
          }
        })
      }
    )
    request.on('timeout', () =>
      request.destroy(new Error('CDP discovery timed out.'))
    )
    request.on('error', reject)
  })
}

function requestOllamaFixture(method, target, body = null) {
  if (ollamaFixture === null) {
    fail('The Ollama scene requires an owned loopback fixture.')
  }
  const endpoint = new URL(ollamaFixture.endpoint)
  const payload = body === null ? null : Buffer.from(JSON.stringify(body))
  return new Promise((resolve, reject) => {
    const request = http.request(
      {
        hostname: '127.0.0.1',
        port: Number(endpoint.port),
        path: target,
        method,
        timeout: 5000,
        headers:
          payload === null
            ? { Accept: 'application/json' }
            : {
                Accept: 'application/json',
                'Content-Type': 'application/json',
                'Content-Length': payload.byteLength,
              },
      },
      response => {
        const chunks = []
        let size = 0
        response.on('data', chunk => {
          size += chunk.byteLength
          if (size > 1024 * 1024) {
            request.destroy(
              new Error('The Ollama fixture response exceeded 1 MiB.')
            )
            return
          }
          chunks.push(chunk)
        })
        response.on('end', () => {
          if (response.statusCode !== 200) {
            reject(
              new Error(
                `The Ollama fixture returned HTTP ${response.statusCode}.`
              )
            )
            return
          }
          try {
            resolve(JSON.parse(Buffer.concat(chunks).toString('utf8')))
          } catch (error) {
            reject(error)
          }
        })
      }
    )
    request.on('timeout', () =>
      request.destroy(new Error('The Ollama fixture request timed out.'))
    )
    request.on('error', reject)
    request.end(payload ?? undefined)
  })
}

async function waitForOllamaFixture(predicate, label, timeout = 10000) {
  const deadline = Date.now() + timeout
  while (Date.now() < deadline) {
    const state = await requestOllamaFixture('GET', '/__fixture__/state')
    if (predicate(state)) {
      return state
    }
    await sleep(200)
  }
  fail(`Timed out waiting for Ollama fixture ${label}.`)
}

function assertBaseOllamaFixtureState(state, label) {
  const expectedInstalled = [
    'material-chat:7b',
    'material-embed:latest',
    'material-vision:3b',
  ]
  if (
    state?.fixture !== 'desktop-material-ollama' ||
    JSON.stringify(state.installedModels) !==
      JSON.stringify(expectedInstalled) ||
    JSON.stringify(state.runningModels) !==
      JSON.stringify(['material-chat:7b']) ||
    JSON.stringify(state.activePulls) !== JSON.stringify([]) ||
    state.faultMode !== 'none'
  ) {
    fail(`Ollama fixture ${label} was not canonical: ${JSON.stringify(state)}`)
  }
}

class CDPClient {
  constructor(url) {
    this.socket = new WebSocket(url, {
      handshakeTimeout: 5000,
      maxPayload: 64 * 1024 * 1024,
    })
    this.nextId = 1
    this.pending = new Map()
  }

  async open() {
    await new Promise((resolve, reject) => {
      this.socket.once('open', resolve)
      this.socket.once('error', reject)
    })
    this.socket.on('message', data => {
      const message = JSON.parse(String(data))
      if (message.id === undefined) {
        return
      }
      const pending = this.pending.get(message.id)
      if (pending === undefined) {
        return
      }
      this.pending.delete(message.id)
      if (message.error !== undefined) {
        pending.reject(new Error(message.error.message ?? 'CDP failure'))
      } else {
        pending.resolve(message.result)
      }
    })
    this.socket.on('close', () => {
      for (const pending of this.pending.values()) {
        pending.reject(new Error('CDP connection closed.'))
      }
      this.pending.clear()
    })
  }

  send(method, params = {}) {
    const id = this.nextId++
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject })
      this.socket.send(JSON.stringify({ id, method, params }), error => {
        if (error != null) {
          this.pending.delete(id)
          reject(error)
        }
      })
    })
  }

  close() {
    this.socket.close()
  }
}

let client = null

async function evaluate(expression) {
  const result = await client.send('Runtime.evaluate', {
    expression,
    awaitPromise: true,
    returnByValue: true,
    userGesture: true,
  })
  if (result.exceptionDetails !== undefined) {
    fail(
      result.exceptionDetails.exception?.description ??
        result.exceptionDetails.text ??
        'Renderer evaluation failed.'
    )
  }
  return result.result?.value
}

const sleep = ms => new Promise(resolve => setTimeout(resolve, ms))

async function waitFor(expression, label, timeout = 20000) {
  const deadline = Date.now() + timeout
  while (Date.now() < deadline) {
    try {
      if (await evaluate(expression)) {
        return
      }
    } catch {}
    await sleep(300)
  }
  fail(`Timed out waiting for ${label}.`)
}

async function setViewport(width = DefaultWidth, height = DefaultHeight) {
  await client.send('Emulation.setDeviceMetricsOverride', {
    width,
    height,
    deviceScaleFactor: 1,
    mobile: false,
  })
  currentViewportWidth = width
  currentViewportHeight = height
  await sleep(350)
}

async function restoreCaptureViewport() {
  await setViewport(CaptureWidth, CaptureHeight)
}

async function assertCapturePrivacy(name) {
  const evidence = await evaluate(`(() => {
    const visible = element => {
      if (!(element instanceof HTMLElement)) return false
      const style = getComputedStyle(element)
      const bounds = element.getBoundingClientRect()
      return style.display !== 'none' && style.visibility !== 'hidden' &&
        Number(style.opacity || 1) !== 0 && bounds.width > 0 && bounds.height > 0
    }
    const values = [...document.querySelectorAll('input, textarea')]
      .filter(visible)
      .map(element => element.value)
    const bundledAsset = value =>
      /^file:\/\/\/[a-z]:\/(?:[^?#]*\/)?out\/static\/[a-z0-9._-]+\.(?:gif|ico|png|svg|webp)(?:[?#].*)?$/i.test(value)
    const attributes = [...document.querySelectorAll('[title], a[href], img[src]')]
      .filter(visible)
      .flatMap(element => [
        element.getAttribute('title') ?? '',
        element.getAttribute('href') ?? '',
        element.getAttribute('src') ?? '',
      ])
      .filter(value => !bundledAsset(value))
    return {
      text: document.body.innerText,
      values,
      attributes,
    }
  })()`)
  const serialized = [
    evidence?.text ?? '',
    ...(evidence?.values ?? []),
    ...(evidence?.attributes ?? []),
  ].join('\n')
  const privatePath =
    /C:\\Users\\|C:\/Users\/|ADMINI~1|AppData[\\/]|(?:^|[\\/])Temp[\\/]|desktop-material-p0-ui-/i
  const match = privatePath.exec(serialized)
  if (match !== null) {
    const start = Math.max(0, match.index - 80)
    const end = Math.min(serialized.length, match.index + match[0].length + 80)
    fail(
      `Capture ${name} exposed a private path near ${JSON.stringify(
        serialized.slice(start, end)
      )}.`
    )
  }
}

function sha256File(file) {
  return crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex')
}

function pngDimensions(file) {
  const bytes = fs.readFileSync(file)
  const signature = '89504e470d0a1a0a'
  if (
    bytes.byteLength < 24 ||
    bytes.subarray(0, 8).toString('hex') !== signature ||
    bytes.subarray(12, 16).toString('ascii') !== 'IHDR'
  ) {
    fail(`Capture ${path.basename(file)} is not a valid PNG.`)
  }
  return {
    width: bytes.readUInt32BE(16),
    height: bytes.readUInt32BE(20),
  }
}

/** Remove unrelated transient chrome and focus paint from documentation frames. */
async function prepareCaptureSurface(name) {
  const receipt = await evaluate(`(() => {
    const undo = document.querySelector('#undo-commit')
    if (undo instanceof HTMLElement) {
      undo.style.setProperty('display', 'none', 'important')
      undo.setAttribute('data-capture-suppressed', 'true')
    }
    const focused = document.activeElement
    if (focused instanceof HTMLElement) focused.blur()
    return new Promise(resolve => requestAnimationFrame(() =>
      requestAnimationFrame(() => {
        const suppressed = document.querySelector('#undo-commit')
        const bounds = suppressed instanceof HTMLElement
          ? suppressed.getBoundingClientRect()
          : null
        resolve({
          undoPresent: suppressed instanceof HTMLElement,
          undoHidden: !(suppressed instanceof HTMLElement) ||
            getComputedStyle(suppressed).display === 'none' ||
            bounds.width === 0 || bounds.height === 0,
          activeTag: document.activeElement?.tagName ?? null,
        })
      })
    ))
  })()`)
  if (receipt?.undoHidden !== true) {
    fail(
      `Capture ${name} retained unrelated Undo commit chrome: ${JSON.stringify(
        receipt
      )}`
    )
  }
}

async function capture(name) {
  if (outDir === null) {
    fail('Capture scenes require an explicit disposable --out directory.')
  }
  const trackedScreenshots = path.join(
    repoRoot,
    'docs',
    'assets',
    'screenshots'
  )
  const relativeToTracked = path.relative(trackedScreenshots, outDir)
  if (
    relativeToTracked === '' ||
    (!path.isAbsolute(relativeToTracked) &&
      relativeToTracked !== '..' &&
      !relativeToTracked.startsWith(`..${path.sep}`))
  ) {
    fail('Capture candidates must be reviewed in Temp before promotion.')
  }
  await prepareCaptureSurface(name)
  await assertCapturePrivacy(name)
  fs.mkdirSync(outDir, { recursive: true })
  const shot = await client.send('Page.captureScreenshot', { format: 'png' })
  const file = path.join(outDir, `${name}.png`)
  fs.writeFileSync(file, Buffer.from(shot.data, 'base64'), { flag: 'wx' })
  const dimensions = pngDimensions(file)
  if (
    dimensions.width !== currentViewportWidth ||
    dimensions.height !== currentViewportHeight
  ) {
    fail(
      `Capture ${name}.png has unexpected dimensions: ${JSON.stringify({
        expected: {
          width: currentViewportWidth,
          height: currentViewportHeight,
        },
        actual: dimensions,
      })}`
    )
  }
  const digest = sha256File(file)
  const duplicate = capturedHashes.get(digest)
  if (duplicate !== undefined) {
    fail(`Capture ${name}.png duplicates ${duplicate}.png byte-for-byte.`)
  }
  capturedHashes.set(digest, name)
  capturedNames.push(name)
  const size = fs.statSync(file).size
  process.stdout.write(
    `CAPTURED ${name}.png ${size}b ${dimensions.width}x${dimensions.height}\n`
  )
  if (size < 20000) {
    process.stdout.write(`WARN ${name}.png is suspiciously small\n`)
  }
  return file
}

/** Emit a menu event directly to the renderer's ipc listener. */
async function menuEvent(name) {
  await evaluate(
    `require('electron').ipcRenderer.emit('menu-event', {}, ${JSON.stringify(
      name
    )}), true`
  )
  await sleep(500)
}

async function pressEscape(times = 1) {
  for (let index = 0; index < times; index++) {
    for (const type of ['rawKeyDown', 'keyUp']) {
      await client.send('Input.dispatchKeyEvent', {
        type,
        key: 'Escape',
        code: 'Escape',
        windowsVirtualKeyCode: 27,
      })
    }
    await sleep(300)
  }
}

async function clickText(label, options = {}) {
  const clicked = await evaluate(`(() => {
    const scope = ${
      options.within
        ? `document.querySelector(${JSON.stringify(options.within)})`
        : 'document'
    }
    if (!scope) return false
    const nodes = [...scope.querySelectorAll('button, [role="button"], a')]
    const target = nodes.find(node =>
      node.textContent.trim() === ${JSON.stringify(label)} &&
      node.getAttribute('aria-disabled') !== 'true' && !node.disabled
    )
    if (!target) return false
    target.scrollIntoView({ block: 'nearest' })
    target.click()
    return true
  })()`)
  if (!clicked && options.optional !== true) {
    fail(`Unable to activate "${label}".`)
  }
  return clicked
}

/**
 * Activate one enabled React-controlled text action at most once. Unlike the
 * generic waitFor helper, evaluation errors propagate so a lost response after
 * target.click() cannot retry the activation.
 */
async function clickTextWhenEnabled(label, options = {}) {
  const deadline = Date.now() + (options.timeout ?? 20000)
  while (Date.now() < deadline) {
    const clicked = await evaluate(`(() => {
      const scope = ${
        options.within
          ? `document.querySelector(${JSON.stringify(options.within)})`
          : 'document'
      }
      if (!scope) return false
      const target = [...scope.querySelectorAll('button, [role="button"], a')]
        .find(candidate => candidate.textContent.trim() === ${JSON.stringify(
          label
        )} && candidate.getAttribute('aria-disabled') !== 'true' &&
          !candidate.disabled)
      if (!target) return false
      target.click()
      return true
    })()`)
    if (clicked) {
      return
    }
    await sleep(300)
  }
  fail(`Timed out waiting to activate "${label}".`)
}

async function clickSelector(selector, options = {}) {
  const clicked = await evaluate(`(() => {
    const target = document.querySelector(${JSON.stringify(selector)})
    if (!(target instanceof HTMLElement)) return false
    target.scrollIntoView({ block: 'nearest' })
    target.click()
    return true
  })()`)
  if (!clicked && options.optional !== true) {
    fail(`Unable to click ${selector}.`)
  }
  return clicked
}

async function clickEnabledSelector(selector) {
  const clicked = await evaluate(`(() => {
    const target = document.querySelector(${JSON.stringify(selector)})
    if (!(target instanceof HTMLElement)) return false
    if (target.matches(':disabled') || target.getAttribute('aria-disabled') === 'true') {
      return false
    }
    target.scrollIntoView({ block: 'nearest' })
    target.click()
    return true
  })()`)
  if (!clicked) {
    fail(`Unable to click enabled control ${selector}.`)
  }
}

const ThemeToggleSelector =
  'button.theme-toggle-button[aria-label="Toggle theme"]'

async function setThemeThroughToggle(theme) {
  if (!['light', 'dark', 'system'].includes(theme)) {
    fail(`Unsupported capture theme: ${theme}`)
  }
  const expectedLabel = `${theme[0].toUpperCase()}${theme.slice(1)} theme`
  const expectedBodyClass =
    theme === 'dark' ? 'theme-dark' : theme === 'light' ? 'theme-light' : null

  for (let attempt = 0; attempt <= 3; attempt++) {
    const selected = await evaluate(`(() => {
      const button = document.querySelector(${JSON.stringify(
        ThemeToggleSelector
      )})
      return button instanceof HTMLButtonElement &&
        button.textContent.trim() === ${JSON.stringify(expectedLabel)} &&
        localStorage.getItem('theme') === ${JSON.stringify(theme)}
    })()`)
    if (selected) {
      if (expectedBodyClass !== null) {
        await waitFor(
          `document.body.classList.contains(${JSON.stringify(
            expectedBodyClass
          )})`,
          `applied ${theme} capture theme`
        )
      }
      return
    }
    if (attempt === 3) {
      break
    }

    const previousLabel = await evaluate(
      `document.querySelector(${JSON.stringify(
        ThemeToggleSelector
      )})?.textContent?.trim() ?? null`
    )
    await clickEnabledSelector(ThemeToggleSelector)
    await waitFor(
      `document.querySelector(${JSON.stringify(
        ThemeToggleSelector
      )})?.textContent?.trim() !== ${JSON.stringify(previousLabel)}`,
      `theme toggle transition toward ${theme}`
    )
  }
  fail(`Unable to settle the capture theme at ${theme}.`)
}

/** Exercise list rows whose selection contract is owned by mouse down/up. */
async function clickPointerSelector(selector) {
  const clicked = await evaluate(`(() => {
    const target = document.querySelector(${JSON.stringify(selector)})
    if (!(target instanceof HTMLElement)) return false
    target.scrollIntoView({ block: 'nearest' })
    const bounds = target.getBoundingClientRect()
    const init = {
      bubbles: true,
      cancelable: true,
      clientX: bounds.left + Math.min(24, bounds.width / 2),
      clientY: bounds.top + Math.min(16, bounds.height / 2),
      button: 0,
      buttons: 1,
    }
    target.dispatchEvent(new MouseEvent('mousedown', init))
    target.dispatchEvent(new MouseEvent('mouseup', { ...init, buttons: 0 }))
    target.dispatchEvent(new MouseEvent('click', { ...init, buttons: 0 }))
    return true
  })()`)
  if (!clicked) {
    fail(`Unable to pointer-click ${selector}.`)
  }
}

/** Open the editor owned by a concrete element through its pointer contract. */
async function contextMenuSelector(selector) {
  const opened = await evaluate(`(() => {
    const target = document.querySelector(${JSON.stringify(selector)})
    if (!(target instanceof HTMLElement)) return false
    const bounds = target.getBoundingClientRect()
    target.dispatchEvent(new MouseEvent('contextmenu', {
      bubbles: true,
      cancelable: true,
      clientX: bounds.left + Math.min(24, bounds.width / 2),
      clientY: bounds.top + Math.min(18, bounds.height / 2),
    }))
    return true
  })()`)
  if (!opened) {
    fail(`Unable to context-menu ${selector}.`)
  }
}

/** Open a focused owner's editor through the accessible keyboard contract. */
async function shiftF10Selector(selector) {
  const opened = await evaluate(`(() => {
    const target = document.querySelector(${JSON.stringify(selector)})
    if (!(target instanceof HTMLElement)) return false
    target.focus()
    target.dispatchEvent(new KeyboardEvent('keydown', {
      key: 'F10',
      code: 'F10',
      shiftKey: true,
      bubbles: true,
      cancelable: true,
    }))
    return true
  })()`)
  if (!opened) {
    fail(`Unable to send Shift+F10 to ${selector}.`)
  }
}

async function waitForPrivacySafeAnchoredEditor(label) {
  await waitFor(
    `document.querySelector('.anchored-appearance-editor') !== null`,
    label
  )
  await waitFor(
    `(() => {
      const editor = document.querySelector('.anchored-appearance-editor')
      const popover = editor?.closest('.popover-component')
      if (!(editor instanceof HTMLElement) || !(popover instanceof HTMLElement)) {
        return false
      }
      const editorBounds = editor.getBoundingClientRect()
      const popoverBounds = popover.getBoundingClientRect()
      const editorStyle = getComputedStyle(editor)
      const popoverStyle = getComputedStyle(popover)
      const visible = style =>
        style.display !== 'none' &&
        style.visibility !== 'hidden' &&
        Number(style.opacity) > 0
      const inViewport = bounds =>
        bounds.width > 0 &&
        bounds.height > 0 &&
        bounds.left >= -0.5 &&
        bounds.top >= -0.5 &&
        bounds.right <= window.innerWidth + 0.5 &&
        bounds.bottom <= window.innerHeight + 0.5
      return visible(editorStyle) &&
        visible(popoverStyle) &&
        inViewport(editorBounds) &&
        inViewport(popoverBounds)
    })()`,
    `${label} positioned inside the viewport`
  )
  const state = await evaluate(`(() => {
    const editor = document.querySelector('.anchored-appearance-editor')
    const repository = editor?.querySelector(
      '.anchored-appearance-editor-repository code'
    )
    return {
      text: editor?.textContent ?? '',
      repository: repository?.textContent ?? '',
    }
  })()`)
  if (
    typeof state?.repository !== 'string' ||
    !state.repository.startsWith('…\\') ||
    /C:\\Users|Temp/i.test(`${state.text} ${state.repository}`)
  ) {
    fail(`Anchored editor exposed a private path: ${JSON.stringify(state)}`)
  }
}

/** Set a React-controlled input's value with native setter + input event. */
async function setInput(selector, value) {
  const done = await evaluate(`(() => {
    const el = document.querySelector(${JSON.stringify(selector)})
    if (!(el instanceof HTMLInputElement) && !(el instanceof HTMLTextAreaElement)) {
      return false
    }
    const proto = el instanceof HTMLTextAreaElement
      ? window.HTMLTextAreaElement.prototype
      : window.HTMLInputElement.prototype
    const setter = Object.getOwnPropertyDescriptor(proto, 'value').set
    setter.call(el, ${JSON.stringify(value)})
    el.dispatchEvent(new Event('input', { bubbles: true }))
    el.dispatchEvent(new Event('change', { bubbles: true }))
    return true
  })()`)
  if (!done) {
    fail(`Unable to set input ${selector}.`)
  }
}

async function setSelect(selector, value) {
  const done = await evaluate(`(() => {
    const element = document.querySelector(${JSON.stringify(selector)})
    if (!(element instanceof HTMLSelectElement)) return false
    if (![...element.options].some(option => option.value === ${JSON.stringify(
      value
    )})) return false
    const setter = Object.getOwnPropertyDescriptor(
      window.HTMLSelectElement.prototype,
      'value'
    ).set
    setter.call(element, ${JSON.stringify(value)})
    element.dispatchEvent(new Event('change', { bubbles: true }))
    return true
  })()`)
  if (!done) {
    fail(`Unable to select ${JSON.stringify(value)} in ${selector}.`)
  }
}

/** Replace private fixture-only pixels without changing the React state. */
async function maskVisibleValue(selector, value) {
  const masked = await evaluate(`(() => {
    const element = document.querySelector(${JSON.stringify(selector)})
    if (!(element instanceof HTMLInputElement) &&
        !(element instanceof HTMLTextAreaElement)) return false
    const proto = element instanceof HTMLTextAreaElement
      ? window.HTMLTextAreaElement.prototype
      : window.HTMLInputElement.prototype
    const setter = Object.getOwnPropertyDescriptor(proto, 'value').set
    setter.call(element, ${JSON.stringify(value)})
    element.removeAttribute('title')
    return true
  })()`)
  if (!masked) {
    fail(`Unable to mask visible value ${selector}.`)
  }
}

async function maskSparseCheckoutRepositoryPath() {
  const masked = await evaluate(`(() => {
    const path = document.querySelector('.sparse-checkout-heading-copy small')
    if (!(path instanceof HTMLElement)) return false
    path.textContent = 'C:\\Synthetic\\material-fixture'
    path.setAttribute('title', 'C:\\Synthetic\\material-fixture')
    return true
  })()`)
  if (!masked) {
    fail('Unable to mask the Sparse Checkout fixture path.')
  }
}

async function maskRepositoryToolsIntroduction() {
  const masked = await evaluate(`(() => {
    const introduction = document.querySelector('.repository-tools-introduction')
    if (!(introduction instanceof HTMLElement)) return false
    introduction.textContent =
      'Status, history, cleanup, transfer, and repair tools for the synthetic fixture — every function runs a reviewed Git recipe with no shell or editable command line.'
    return true
  })()`)
  if (!masked) {
    fail('Unable to mask the Repository Tools fixture path.')
  }
}

async function maskSettingsHistoryPrivatePaths() {
  if (runRoot === undefined) {
    fail('Settings history masking requires the owned Temp run root.')
  }
  const privateRoot = fs.realpathSync.native(path.resolve(runRoot))
  const syntheticRoot = 'C:\\Synthetic\\desktop-material-run'
  const replacements = [
    [privateRoot, syntheticRoot],
    [
      privateRoot.replaceAll('\\', '\\\\'),
      syntheticRoot.replaceAll('\\', '\\\\'),
    ],
  ].sort((left, right) => right[0].length - left[0].length)
  const masked = await evaluate(`(() => {
    const diff = document.querySelector('.versioned-store-history-diff')
    if (!(diff instanceof HTMLElement)) return false
    const replacements = ${JSON.stringify(replacements)}
    for (const line of diff.querySelectorAll('span')) {
      let text = line.textContent ?? ''
      for (const [privateValue, publicValue] of replacements) {
        text = text.split(privateValue).join(publicValue)
      }
      line.textContent = text
    }
    const rendered = diff.textContent ?? ''
    return replacements.every(([privateValue]) =>
      !rendered.includes(privateValue)
    )
  })()`)
  if (!masked) {
    fail('Unable to mask owned paths in the Settings history diff.')
  }
}

function countProviderRequests(method, pathPattern) {
  if (providerRequestLog === null || !fs.existsSync(providerRequestLog)) {
    return 0
  }
  return fs
    .readFileSync(providerRequestLog, 'utf8')
    .split(/\r?\n/)
    .filter(line => line.trim() !== '')
    .map(line => JSON.parse(line))
    .filter(entry => entry.method === method && pathPattern.test(entry.path))
    .length
}

function ensureDirectFixtureProviderRemote() {
  if (ready === null || fixturePath === null) {
    return false
  }

  const endpoint = new URL(ready.endpoint)
  if (!['127.0.0.1', 'localhost', '::1'].includes(endpoint.hostname)) {
    fail(`Fixture provider is not loopback-only: ${endpoint.hostname}`)
  }
  const directURL = `${endpoint.origin}/${ready.owner}/${ready.repository}.git`
  const expectedProxy = `http://127.0.0.1:${endpoint.port}`
  let proxyValues = []
  try {
    proxyValues = execFileSync(
      'git',
      ['-C', fixturePath, 'config', '--get-all', 'http.proxy'],
      { encoding: 'utf8' }
    )
      .split(/\r?\n/)
      .map(value => value.trim())
      .filter(value => value.length > 0)
  } catch (error) {
    if (error?.status !== 1) {
      throw error
    }
  }
  if (
    proxyValues.length > 1 ||
    (proxyValues.length === 1 && proxyValues[0] !== expectedProxy)
  ) {
    fail(`Fixture proxy is not the owned provider: ${proxyValues.join(', ')}`)
  }
  const currentURL = execFileSync(
    'git',
    ['-C', fixturePath, 'remote', 'get-url', 'origin'],
    { encoding: 'utf8' }
  ).trim()
  let changed = false
  if (currentURL !== directURL) {
    execFileSync(
      'git',
      ['-C', fixturePath, 'remote', 'set-url', 'origin', directURL],
      { stdio: 'ignore' }
    )
    changed = true
  }
  if (proxyValues.length === 1) {
    execFileSync(
      'git',
      ['-C', fixturePath, 'config', '--unset-all', 'http.proxy'],
      { stdio: 'ignore' }
    )
    changed = true
  }
  return changed
}

async function seedProfile() {
  const providerRemoteChanged = ensureDirectFixtureProviderRemote()
  const account =
    ready === null
      ? null
      : {
          endpoint: ready.endpoint.replace(/\/$/, ''),
          login: 'material-verifier-p0',
          id: 7130701,
        }
  const users = JSON.stringify(
    account === null
      ? []
      : [
          {
            token: '',
            login: account.login,
            endpoint: account.endpoint,
            emails: [
              {
                email: 'material-verifier@example.invalid',
                verified: true,
                primary: true,
                visibility: 'private',
              },
            ],
            avatarURL: '',
            id: account.id,
            name: 'Material Verification Account',
            plan: 'enterprise',
            provider: 'github',
          },
        ]
  )

  const profileChanged = await evaluate(`(() => {
    let changed = false
    if (localStorage.getItem('autoSwitchTheme') !== null) {
      localStorage.removeItem('autoSwitchTheme')
      changed = true
    }
    const expected = {
      'has-shown-welcome-flow': '1',
      'theme': 'light',
      'language-mode-v1': 'english',
      'zoom-auto-fit-enabled': '1',
      'stats-opt-out': '1',
      'has-sent-stats-opt-in-ping': '1'
    }
    for (const [key, value] of Object.entries(expected)) {
      if (localStorage.getItem(key) !== value) {
        localStorage.setItem(key, value)
        changed = true
      }
    }
    const expectedUsers = ${JSON.stringify(users)}
    let storedUsers = []
    try { storedUsers = JSON.parse(localStorage.getItem('users') || '[]') } catch {}
    const expectedAccount = JSON.parse(expectedUsers)[0]
    const present = expectedAccount === undefined ||
      (Array.isArray(storedUsers) && storedUsers.some(value =>
        value?.provider === expectedAccount.provider &&
        value?.endpoint === expectedAccount.endpoint &&
        value?.login === expectedAccount.login &&
        value?.id === expectedAccount.id))
    if (!present) {
      localStorage.setItem('users', expectedUsers)
      changed = true
    }
    const expectedOllamaProvider = ${JSON.stringify(ollamaProvider)}
    if (expectedOllamaProvider !== null) {
      const expectedProviders = JSON.stringify([expectedOllamaProvider])
      let storedProviders = null
      try {
        storedProviders = JSON.parse(
          localStorage.getItem('copilot-byok-providers') || 'null'
        )
      } catch {}
      if (JSON.stringify(storedProviders) !== expectedProviders) {
        localStorage.setItem('copilot-byok-providers', expectedProviders)
        changed = true
      }
    }
    return changed
  })()`)

  const changed = providerRemoteChanged || profileChanged
  if (changed) {
    const beforeSeedReloadTimeOrigin = await evaluate('performance.timeOrigin')
    await client.send('Page.reload', { ignoreCache: true })
    await sleep(4500)
    await client.send('Runtime.enable')
    await waitFor(
      `performance.timeOrigin > ${JSON.stringify(beforeSeedReloadTimeOrigin)}`,
      'seeded profile renderer reload',
      25000
    )
  }
  if (
    await clickText('Continue without signing in', {
      optional: true,
    })
  ) {
    await sleep(3000)
  }
  if (await clickText('Finish', { optional: true })) {
    await sleep(3500)
  }
  if (await clickText('Skip for now', { optional: true })) {
    await sleep(1800)
  }
  if (account !== null) {
    // A pristine profile can complete the welcome flow before the startup
    // --cli-open request is eligible to persist the fixture. Establish the
    // owned repository explicitly before requiring provider hydration.
    await ensureRepository(fixturePath)
    const hydrated = await evaluate(`(async () => {
      const root = document.querySelector('#desktop-app-container')
      const node = root?.querySelector('*')
      const fiberKey = node && Object.keys(node).find(key =>
        key.startsWith('__reactFiber$') ||
        key.startsWith('__reactInternalInstance$')
      )
      let fiber = fiberKey ? node[fiberKey] : null
      let appStore = null
      for (let depth = 0; fiber && depth < 120; depth++, fiber = fiber.return) {
        if (fiber.stateNode?.props?.appStore) {
          appStore = fiber.stateNode.props.appStore
          break
        }
      }
      if (!appStore) return { appStore: false }

      // The fixture writes account metadata before it owns a signed-in UI
      // surface. Re-read that shared metadata through the store's public
      // cross-window contract, then match the already-open repository.
      await appStore.accountsStore.reloadFromStore()
      if (${ollamaFixture !== null}) {
        await appStore.accountsStore.refresh()
      }
      const accounts = await appStore.accountsStore.getAll()
      const fixtureAccount = accounts.find(value =>
        value.login === ${JSON.stringify(account.login)} &&
        value.endpoint === ${JSON.stringify(account.endpoint)}
      )
      const repository = appStore.selectedRepository
      const freshRepository = repository
        ? await appStore.repositoryWithRefreshedGitHubRepository(repository)
        : null
      await new Promise(resolve => setTimeout(resolve, 500))
      return {
        appStore: true,
        accountCount: accounts.length,
        fixtureAccountMatched: fixtureAccount !== undefined,
        fixtureTokenPresent:
          typeof fixtureAccount?.token === 'string' &&
          fixtureAccount.token.length > 0,
        fixtureCopilotFeatureEnabled:
          fixtureAccount?.features?.includes(
            'desktop_enable_copilot_sdk_commit_message_generation'
          ) === true,
        repositoryMatched: Boolean(freshRepository?.gitHubRepository),
        selectedRepositoryMatched: Boolean(
          appStore.selectedRepository?.gitHubRepository
        ),
      }
    })()`)
    if (
      hydrated?.appStore !== true ||
      hydrated?.accountCount !== 1 ||
      hydrated?.fixtureAccountMatched !== true ||
      hydrated?.fixtureTokenPresent !== true ||
      (ollamaFixture !== null &&
        hydrated?.fixtureCopilotFeatureEnabled !== true) ||
      hydrated?.repositoryMatched !== true ||
      hydrated?.selectedRepositoryMatched !== true
    ) {
      fail(
        `Disposable fixture account/repository hydration failed: ${JSON.stringify(
          hydrated
        )}`
      )
    }
  }
  process.stdout.write(`SEEDED changed=${changed}\n`)
}

async function ensureRepository(repositoryPath = fixturePath) {
  const hasRail = await evaluate(
    `document.querySelector('nav.repository-rail') !== null`
  )
  if (hasRail) {
    return
  }

  await menuEvent('add-local-repository')
  await waitFor(
    `document.querySelector('#add-existing-repository input[type="text"]') !== null`,
    'add repository dialog'
  )
  await setInput('#add-existing-repository input[type="text"]', repositoryPath)
  await sleep(900)
  ;(await clickText('Add repository', { optional: true })) ||
    (await clickText('Add Repository', { optional: true }))
  await waitFor(
    `document.querySelector('nav.repository-rail') !== null`,
    'repository workspace',
    25000
  )
  await sleep(1500)
}

/** Switch to a repository section tab via its rail/tab label. */
async function showSection(label) {
  const done = await evaluate(`(() => {
    const rail = document.querySelector('nav.repository-rail')
    if (!rail) return false
    const target = [...rail.querySelectorAll('button')].find(button => {
      const name = button.getAttribute('aria-label') ?? button.textContent ?? ''
      return name.trim().toLowerCase().startsWith(${JSON.stringify(
        label.toLowerCase()
      )})
    })
    if (!target) return false
    target.click()
    return true
  })()`)
  if (!done) {
    fail(`Unable to activate section ${label}.`)
  }
  await sleep(900)
}

/** Move hover state away so tooltips don't pollute captures. */
async function parkPointer() {
  const viewport = await evaluate(`({
    width: window.innerWidth,
    height: window.innerHeight,
  })`)
  await client.send('Input.dispatchMouseEvent', {
    type: 'mouseMoved',
    x: 1,
    y: Math.max(1, Number(viewport?.height ?? DefaultHeight) - 1),
  })
  await evaluate(`(() => {
    for (const el of document.querySelectorAll(':hover')) {
      el.dispatchEvent(new MouseEvent('mouseleave', { bubbles: true }))
      el.dispatchEvent(new MouseEvent('mouseout', { bubbles: true }))
    }
    document.body.dispatchEvent(new MouseEvent('mousemove', {
      bubbles: true, clientX: 5, clientY: 700,
    }))
    // Hover tooltips render as floating body children. Hide them with an
    // injected style — never remove React-owned nodes from the DOM.
    if (!document.getElementById('gallery-tooltip-suppressor')) {
      const style = document.createElement('style')
      style.id = 'gallery-tooltip-suppressor'
      style.textContent = ${JSON.stringify(
        'body > .tooltip, [role="tooltip"] { display: none !important; }'
      )}
      document.head.appendChild(style)
    }
    return true
  })()`)
  await sleep(400)
}

async function getSceneLeakState() {
  return await evaluate(`(() => {
    const visible = element => {
      if (!(element instanceof HTMLElement)) return false
      const style = getComputedStyle(element)
      const bounds = element.getBoundingClientRect()
      return style.display !== 'none' && style.visibility !== 'hidden' &&
        Number(style.opacity || 1) !== 0 && bounds.width > 0 && bounds.height > 0
    }
    const describe = element => {
      const id = element.id ? '#' + element.id : ''
      const classes = [...element.classList].slice(0, 3).map(name => '.' + name).join('')
      const role = element.getAttribute('role')
      const label = element.getAttribute('aria-label')
      return element.tagName.toLowerCase() + id + classes +
        (role ? '[role="' + role + '"]' : '') +
        (label ? '[aria-label="' + label + '"]' : '')
    }
    const collect = selector => [...new Set(document.querySelectorAll(selector))]
      .filter(visible)
      .map(describe)
    return {
      surfaces: collect(${JSON.stringify(SceneSurfaceSelector)}),
      errors: collect(${JSON.stringify(SceneErrorSelector)}),
      tooltips: collect(${JSON.stringify(SceneTooltipSelector)}),
    }
  })()`)
}

function hasSceneLeaks(state) {
  return (
    state.surfaces.length > 0 ||
    state.errors.length > 0 ||
    state.tooltips.length > 0
  )
}

async function assertNoSceneLeaks(context) {
  const state = await getSceneLeakState()
  if (hasSceneLeaks(state)) {
    fail(
      `Scene reset left visible UI leakage before ${context}: ${JSON.stringify(
        state
      )}`
    )
  }
}

/**
 * Dismiss every transient surface through its own control, then Escape.
 * This deliberately includes non-modal sheets and notices, not only native
 * <dialog> elements, because those surfaces otherwise leak between scenes.
 */
async function dismissSceneSurfaces(context) {
  await parkPointer()

  for (let attempt = 0; attempt < 20; attempt++) {
    const state = await getSceneLeakState()
    if (!hasSceneLeaks(state)) {
      return
    }

    const action = await evaluate(`(() => {
      const visible = element => {
        if (!(element instanceof HTMLElement)) return false
        const style = getComputedStyle(element)
        const bounds = element.getBoundingClientRect()
        return style.display !== 'none' && style.visibility !== 'hidden' &&
          Number(style.opacity || 1) !== 0 && bounds.width > 0 && bounds.height > 0
      }

      const noticeDismiss = [...document.querySelectorAll('.error-notice-dismiss')]
        .find(visible)
      if (noticeDismiss instanceof HTMLElement) {
        noticeDismiss.click()
        return 'error-notice control'
      }

      const surfaces = [...new Set(document.querySelectorAll(
        ${JSON.stringify(SceneSurfaceSelector)}
      ))].filter(visible)
      const surface = surfaces.at(-1)
      if (!(surface instanceof HTMLElement)) return 'escape'

      const controls = [...surface.querySelectorAll('button, [role="button"]')]
        .filter(visible)
      const control =
        surface.querySelector(
          '[aria-label^="Close"], [aria-label^="Dismiss"], ' +
          '.side-sheet-close, .close-button, [data-dialog-dismiss]'
        ) ??
        controls.find(button =>
          ['Cancel', 'Close', 'Done', 'Hide', 'Not now', 'Skip for now'].includes(
            (button.textContent ?? '').trim()
          )
        )
      if (control instanceof HTMLElement && visible(control)) {
        control.click()
        return 'surface control'
      }

      if (surface.matches('.material-context-menu-backdrop')) {
        surface.dispatchEvent(new MouseEvent('mousedown', {
          bubbles: true,
          cancelable: true,
        }))
        return 'context-menu backdrop'
      }

      const overlay = surface.querySelector('.overlay')
      if (overlay instanceof HTMLElement && visible(overlay)) {
        overlay.click()
        return 'foldout overlay'
      }

      return 'escape'
    })()`)

    if (action === 'escape') {
      await pressEscape(1)
    } else {
      await sleep(350)
    }
  }

  await assertNoSceneLeaks(context)
}

/** Backwards-compatible cleanup used by existing scene implementations. */
async function closeAllDialogs() {
  await dismissSceneSurfaces('scene cleanup')
}

const StatePreservingScenes = new Set([
  'seed',
  'dump',
  'raw-feature-highlights',
  'welcome',
  'complete-welcome',
  'state-shot',
  'dismiss-checklist',
  'raw-artifacts',
  'raw-digest',
  'raw-artifact-pages',
  'raw-job-log',
  'raw-deployments',
])

async function getBaseSurfaceState() {
  return await evaluate(`(() => {
    const changes = document.getElementById('changes-tab')
    const changesTab = changes?.closest('[role="tab"]')
    return {
      repositoryRail: document.querySelector('nav.repository-rail') !== null,
      changesSelected: changesTab?.getAttribute('aria-selected') === 'true',
      welcome: document.querySelector('#welcome') !== null,
      noRepositories: document.querySelector('#no-repositories') !== null,
    }
  })()`)
}

async function resetSceneState(name) {
  await restoreCaptureViewport()
  await dismissSceneSurfaces(`scene ${name}`)
  await menuEvent('zoom-reset')

  const preservesState = StatePreservingScenes.has(name)
  let base = 'preserved workflow state'
  if (!preservesState) {
    const before = await getBaseSurfaceState()
    if (before.repositoryRail) {
      await menuEvent('show-changes')
      await waitFor(
        `document.getElementById('changes-tab')?.closest('[role="tab"]')?.getAttribute('aria-selected') === 'true'`,
        `Changes base surface before ${name}`
      )
      base = 'Changes'
    } else if (before.welcome) {
      base = 'Welcome'
    } else if (before.noRepositories) {
      base = 'No repositories'
    } else {
      fail(`No known base surface is available before ${name}.`)
    }
  }

  await parkPointer()
  await assertNoSceneLeaks(`scene ${name}`)

  if (!preservesState) {
    const after = await getBaseSurfaceState()
    const validBase = after.repositoryRail
      ? after.changesSelected
      : after.welcome || after.noRepositories
    if (!validBase) {
      fail(
        `Scene ${name} did not reset to a known base surface: ${JSON.stringify(
          after
        )}`
      )
    }
  }

  process.stdout.write(`RESET ${name} base=${base}\n`)
}

/** The compact history mode hides the commit list; bring it back. */
async function ensureCommitList() {
  const deadline = Date.now() + 10000
  while (Date.now() < deadline) {
    const hasList = await evaluate(
      `document.querySelector('#commit-list .list-item, .commit-list .list-item') !== null`
    )
    if (hasList) {
      return
    }
    await clickSelector('.compact-history-list-button', { optional: true })
    await sleep(800)
  }
  fail('Commit list did not appear.')
}

const scenes = new Map()
const scene = (name, run) => scenes.set(name, run)

scene('seed', async () => {
  await seedProfile()
})

scene('dump', async () => {
  const summary = await evaluate(`(() => {
    const texts = selector => [...document.querySelectorAll(selector)].map(el => ({
      label: el.getAttribute('aria-label'),
      text: (el.textContent ?? '').trim().slice(0, 50),
    }))
    return {
      title: document.title,
      hasRequire: typeof require === 'function',
      railButtons: texts('nav.repository-rail button'),
      tabButtons: texts('.repository-rail [role="tab"], [class*="rail"] button').slice(0, 24),
      dialogs: [...document.querySelectorAll('dialog')].map(d => d.id),
      blankslate: document.querySelector('#no-repositories') !== null,
      toolbar: texts('.toolbar-button, [class*="toolbar"] > button').slice(0, 16),
    }
  })()`)
  process.stdout.write(`DUMP ${JSON.stringify(summary, null, 1)}\n`)
})

scene('raw-feature-highlights', async () => {
  await closeAllDialogs()
  await evaluate(
    `document.body.setAttribute('data-dm-highlight-features', ''), true`
  )
  await sleep(500)
  await parkPointer()
  await capture('material-feature-highlights-compact')
})

scene('welcome', async () => {
  const inWelcome = await evaluate(
    `document.querySelector('#welcome') !== null`
  )
  if (!inWelcome) {
    process.stdout.write('SKIP welcome (already completed)\n')
    return
  }
  await sleep(800)
  await capture('material-welcome')
})

scene('complete-welcome', async () => {
  for (let step = 0; step < 6; step++) {
    const inWelcome = await evaluate(
      `document.querySelector('#welcome') !== null`
    )
    if (!inWelcome) {
      return
    }
    const advanced =
      (await clickText('Continue without signing in', { optional: true })) ||
      (await clickText('Continue', { optional: true })) ||
      (await clickText('Finish', { optional: true })) ||
      (await clickText('Get started', { optional: true })) ||
      (await clickText('Done', { optional: true })) ||
      (await clickText('Skip this step', { optional: true }))
    if (!advanced) {
      const controls = await evaluate(
        `[...document.querySelectorAll('#welcome a, #welcome button')].map(e => (e.textContent||'').trim()).filter(t => t)`
      )
      fail(`Welcome flow stuck; controls: ${JSON.stringify(controls)}`)
    }
    await sleep(1400)
  }
  fail('Welcome flow did not finish within 6 steps.')
})

scene('state-shot', async () => {
  await capture('current-state')
})

scene('dismiss-checklist', async () => {
  await clickText('Skip for now', { optional: true })
  await sleep(800)
})

scene('ensure-repo', async () => {
  await ensureRepository()
})

scene('workspace-changes', async () => {
  await ensureRepository()
  fs.writeFileSync(
    path.join(fixturePath, 'material-notes.md'),
    '# Material verification notes\n\nDeterministic fixture change.\n'
  )
  fs.writeFileSync(
    path.join(fixturePath, 'docs-outline.md'),
    '# Outline\n\n- workspace\n- history\n'
  )
  await menuEvent('show-changes')
  await sleep(2500)
  await capture('material-workspace-changes')
})

scene('history', async () => {
  await ensureRepository()
  await menuEvent('show-history')
  await sleep(1500)
  await ensureCommitList()
  await evaluate(`(() => {
    const row = document.querySelector('#commit-list .list-item, .commit-list .list-item')
    if (row instanceof HTMLElement) row.click()
    return true
  })()`)
  await sleep(1200)
  await parkPointer()
  await capture('material-history')
})

scene('history-context-actions', async () => {
  await ensureRepository()
  await menuEvent('show-history')
  await sleep(1200)
  await ensureCommitList()
  const opened = await evaluate(`(() => {
    const row = document.querySelector('#commit-list .list-item, .commit-list .list-item')
    if (!(row instanceof HTMLElement)) return false
    const rect = row.getBoundingClientRect()
    row.dispatchEvent(new MouseEvent('contextmenu', {
      bubbles: true, cancelable: true,
      clientX: rect.left + 150, clientY: rect.top + 16,
    }))
    return true
  })()`)
  if (!opened) {
    fail('No commit row for the context menu.')
  }
  await waitFor(
    `document.querySelector('.material-context-menu') !== null`,
    'material context menu',
    8000
  )
  await parkPointer()
  await capture('material-history-context-actions')
  await closeAllDialogs()
})

scene('branches-sheet', async () => {
  await ensureRepository()
  await menuEvent('show-branches')
  await sleep(1200)
  const layout = await evaluate(`(() => {
    const sheet = document.querySelector('#foldout-container .foldout')
    const row = document.querySelector('.branches-container .merge-button-row')
    const merge = document.querySelector('.branches-container .merge-button')
    const mergeAll = document.querySelector(
      '.branches-container .merge-all-button'
    )
    const newBranch = document.querySelector(
      '.branches-container .new-branch-button'
    )
    const elements = { sheet, row, merge, mergeAll, newBranch }
    if (Object.values(elements).some(value => !(value instanceof HTMLElement))) {
      return null
    }
    const bounds = element => {
      const rect = element.getBoundingClientRect()
      const style = getComputedStyle(element)
      return {
        left: rect.left,
        right: rect.right,
        top: rect.top,
        bottom: rect.bottom,
        width: rect.width,
        height: rect.height,
        visible:
          style.display !== 'none' &&
          style.visibility !== 'hidden' &&
          Number(style.opacity) > 0,
        clientWidth: element.clientWidth,
        scrollWidth: element.scrollWidth,
        clientHeight: element.clientHeight,
        scrollHeight: element.scrollHeight,
      }
    }
    return Object.fromEntries(
      Object.entries(elements).map(([name, element]) => [name, bounds(element)])
    )
  })()`)
  const within = (child, parent) =>
    child.left >= parent.left - 0.5 &&
    child.right <= parent.right + 0.5 &&
    child.top >= parent.top - 0.5 &&
    child.bottom <= parent.bottom + 0.5
  const intersects = (first, second) =>
    first.left < second.right - 0.5 &&
    first.right > second.left + 0.5 &&
    first.top < second.bottom - 0.5 &&
    first.bottom > second.top + 0.5
  const names = ['row', 'merge', 'mergeAll', 'newBranch']
  if (
    layout === null ||
    names.some(
      name =>
        !layout[name].visible ||
        layout[name].width <= 0 ||
        layout[name].height <= 0 ||
        !within(layout[name], layout.sheet)
    ) ||
    layout.row.scrollWidth > layout.row.clientWidth + 1 ||
    layout.row.scrollHeight > layout.row.clientHeight + 1 ||
    intersects(layout.newBranch, layout.merge) ||
    intersects(layout.newBranch, layout.mergeAll)
  ) {
    fail(
      `Branch sheet controls are clipped or overlapping: ${JSON.stringify(
        layout
      )}`
    )
  }
  await capture('material-branches-sheet')
  await closeAllDialogs()
})

scene('repositories-sheet', async () => {
  await ensureRepository()
  await menuEvent('choose-repository')
  await sleep(1200)
  const actionLayout = await evaluate(`(() => {
    const sheet = document.querySelector('#foldout-container .foldout')
    const actions = document.querySelector('.repository-list-actions')
    if (!(sheet instanceof HTMLElement) || !(actions instanceof HTMLElement)) {
      return null
    }
    const sheetBounds = sheet.getBoundingClientRect()
    const buttons = [...actions.querySelectorAll('button')].map(button => {
      const bounds = button.getBoundingClientRect()
      return {
        label: button.textContent.trim(),
        left: bounds.left,
        right: bounds.right,
        top: bounds.top,
        bottom: bounds.bottom,
      }
    })
    return {
      sheet: {
        left: sheetBounds.left,
        right: sheetBounds.right,
        top: sheetBounds.top,
        bottom: sheetBounds.bottom,
      },
      buttons,
    }
  })()`)
  const expectedActions = ['Sync repositories', 'Commit & push all', 'Add']
  const clippedActions =
    actionLayout === null
      ? expectedActions
      : expectedActions.filter(label => {
          const button = actionLayout.buttons.find(item => item.label === label)
          return (
            button === undefined ||
            button.left < actionLayout.sheet.left - 0.5 ||
            button.right > actionLayout.sheet.right + 0.5 ||
            button.top < actionLayout.sheet.top - 0.5 ||
            button.bottom > actionLayout.sheet.bottom + 0.5
          )
        })
  if (clippedActions.length > 0) {
    fail(
      `Repository sheet clips or omits actions: ${clippedActions.join(', ')}.`
    )
  }
  await capture('material-repositories-sheet')
  await closeAllDialogs()
})

scene('settings', async () => {
  await captureSettingsTab('Git', 'material-settings')
})

/** Open Settings on a named tab and capture. */
async function captureSettingsTab(tabLabel, name, beforeCapture = null) {
  await ensureRepository()
  await menuEvent('show-preferences')
  await waitFor(
    `document.querySelector('#preferences') !== null`,
    'settings dialog'
  )
  await clickText(tabLabel, { within: '#preferences' })

  const tabId = `preferences-tab-${tabLabel.toLowerCase().replace(/\s+/g, '-')}`
  const selectedTabReady = `(() => {
    const dialog = document.querySelector('#preferences')
    const label = document.getElementById(${JSON.stringify(tabId)})
    const tab = label?.closest('button[role="tab"]')
    const panel = dialog?.querySelector('[role="tabpanel"]')
    if (!(dialog instanceof HTMLDialogElement) ||
        !(label instanceof HTMLElement) ||
        !(tab instanceof HTMLButtonElement) ||
        !(panel instanceof HTMLElement)) {
      return false
    }
    const bounds = panel.getBoundingClientRect()
    const activeFiniteAnimations = dialog
      .getAnimations({ subtree: true })
      .filter(animation => {
        const iterations = animation.effect?.getTiming().iterations ?? 1
        return iterations !== Infinity &&
          (animation.pending || animation.playState === 'running')
      })
    return label.textContent.trim() === ${JSON.stringify(tabLabel)} &&
      tab.classList.contains('selected') &&
      tab.getAttribute('aria-selected') === 'true' &&
      panel.getAttribute('aria-labelledby') === ${JSON.stringify(tabId)} &&
      bounds.width > 0 && bounds.height > 0 &&
      activeFiniteAnimations.length === 0
  })()`
  await waitFor(selectedTabReady, `selected ${tabLabel} settings tab`)
  await evaluate(
    `new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve(true))))`
  )
  await waitFor(selectedTabReady, `stable selected ${tabLabel} settings tab`)
  if (beforeCapture !== null) {
    await beforeCapture()
  }
  await parkPointer()
  await capture(name)
  await closeAllDialogs()
}

scene('settings-agent-access', async () => {
  await captureSettingsTab('Agent access', 'material-agent-access')
})

scene('anchored-appearance', async () => {
  await ensureRepository()
  await menuEvent('show-changes')
  await contextMenuSelector('#desktop-app-toolbar')
  await waitForPrivacySafeAnchoredEditor(
    'repository toolbar owner appearance editor'
  )
  await waitFor(
    `document.querySelector('.anchored-appearance-editor')?.textContent?.includes('Repository toolbar appearance') === true`,
    'repository toolbar appearance title'
  )
  await sleep(900)
  await parkPointer()
  await capture('material-customization')
  await closeAllDialogs()
})

scene('settings-accounts', async () => {
  await captureSettingsTab('Accounts', 'material-provider-accounts')
})

scene('ollama-manager', async () => {
  if (ollamaFixture === null || ollamaProvider === null) {
    fail('The Ollama manager scene requires --ollama-run-root.')
  }

  const resetState = await requestOllamaFixture(
    'POST',
    '/__fixture__/reset',
    {}
  )
  assertBaseOllamaFixtureState(resetState, 'pre-exercise reset')
  const auditBefore = await requestOllamaFixture('GET', '/__fixture__/audit')
  const auditStartSequence = Math.max(
    0,
    ...(auditBefore?.events ?? []).map(event => Number(event.sequence) || 0)
  )

  await setViewport(1452, 1001)
  await setThemeThroughToggle('dark')

  try {
    await captureSettingsTab(
      'Copilot',
      'material-ollama-model-manager',
      async () => {
        await clickText('Providers', { within: '#preferences' })
        await waitFor(
          `(() => {
            const root = document.querySelector('#preferences')
            const tab = [...(root?.querySelectorAll('button[role="tab"]') ?? [])]
              .find(candidate => candidate.textContent.trim() === 'Providers')
            return tab?.getAttribute('aria-selected') === 'true'
          })()`,
          'selected Copilot Providers tab'
        )
        await clickText('Manage models', { within: '#preferences' })

        const managerReady = `(() => {
          const manager = document.querySelector('[data-verification="ollama-manager"]')
          const rows = [...document.querySelectorAll(
            '[data-verification="ollama-model-row"]'
          )]
          const names = rows.map(row => row.getAttribute('data-model'))
          const details = document.querySelector('[data-verification="ollama-details"]')
          const refresh = document.querySelector('[data-verification="ollama-refresh"]')
          return manager?.getAttribute('aria-busy') === 'false' &&
            refresh instanceof HTMLButtonElement && !refresh.disabled &&
            refresh.textContent.trim() === 'Refresh' &&
            document.querySelector('[data-verification="ollama-endpoint-status"]')
              ?.textContent?.trim() === 'Connected' &&
            JSON.stringify(names) === JSON.stringify([
              'material-chat:7b',
              'material-embed:latest',
              'material-vision:3b'
            ]) &&
            rows[0]?.getAttribute('aria-pressed') === 'true' &&
            details?.textContent?.includes('material-chat:7b') === true &&
            document.querySelector('.ollama-details-state') === null
        })()`
        await waitFor(managerReady, 'initial Ollama manager inventory', 30000)

        await setInput('[data-verification="ollama-filter"]', 'vision')
        await waitFor(
          `(() => {
            const rows = [...document.querySelectorAll(
              '[data-verification="ollama-model-row"]'
            )]
            return document.querySelector('.ollama-inventory-count')
              ?.textContent?.trim() === 'Showing 1 of 3 models' &&
              rows.length === 1 && rows[0].getAttribute('data-model') ===
                'material-vision:3b'
          })()`,
          'filtered Ollama inventory'
        )
        await setInput('[data-verification="ollama-filter"]', '')
        await setSelect('[data-verification="ollama-scope"]', 'running')
        await waitFor(
          `(() => {
            const rows = [...document.querySelectorAll(
              '[data-verification="ollama-model-row"]'
            )]
            return document.querySelector('.ollama-inventory-count')
              ?.textContent?.trim() === 'Showing 1 of 3 models' &&
              rows.length === 1 && rows[0].getAttribute('data-model') ===
                'material-chat:7b'
          })()`,
          'running-only Ollama inventory'
        )
        await setSelect('[data-verification="ollama-scope"]', 'all')
        await waitFor(managerReady, 'restored full Ollama inventory')

        await setInput(
          '[data-verification="ollama-pull-name"]',
          'material-code:1.5b'
        )
        await clickEnabledSelector('[data-verification="ollama-pull"]')
        await waitFor(
          `document.querySelector('[data-verification="ollama-pull-progress"] progress') !== null &&
           document.querySelector('[data-verification="ollama-pull-cancel"]') instanceof HTMLButtonElement`,
          'visible cancellable Ollama pull progress'
        )
        await clickEnabledSelector('[data-verification="ollama-pull-cancel"]')
        await waitFor(
          `(() => {
            const manager = document.querySelector('[data-verification="ollama-manager"]')
            const notice = document.querySelector('[data-verification="ollama-notice"]')
            const refresh = document.querySelector('[data-verification="ollama-refresh"]')
            return manager?.getAttribute('aria-busy') === 'false' &&
              refresh instanceof HTMLButtonElement && !refresh.disabled &&
              refresh.textContent.trim() === 'Refresh' &&
              notice?.textContent?.includes('canceled') === true &&
              document.querySelector('[data-verification="ollama-pull-progress"]') === null &&
              document.querySelectorAll('[data-verification="ollama-model-row"]').length === 3
          })()`,
          'completed Ollama pull cancellation'
        )
        const afterCancellation = await waitForOllamaFixture(
          state =>
            JSON.stringify(state?.activePulls) === JSON.stringify([]) &&
            state?.installedModels?.includes('material-code:1.5b') !== true,
          'pull cancellation cleanup'
        )
        assertBaseOllamaFixtureState(
          afterCancellation,
          'after pull cancellation'
        )

        await clickEnabledSelector(
          '[data-verification="ollama-model-row"][data-model="material-embed:latest"]'
        )
        await waitFor(
          `document.querySelector('[data-verification="ollama-model-row"][data-model="material-embed:latest"]')?.getAttribute('aria-pressed') === 'true' &&
           document.querySelector('.ollama-details-state') === null`,
          'selected copy source model'
        )
        await setInput(
          '[data-verification="ollama-copy-name"]',
          'material-gallery-copy:latest'
        )
        await clickEnabledSelector('[data-verification="ollama-copy"]')
        await waitFor(
          `(() => {
            const manager = document.querySelector('[data-verification="ollama-manager"]')
            const copy = document.querySelector(
              '[data-verification="ollama-model-row"][data-model="material-gallery-copy:latest"]'
            )
            const notice = document.querySelector('[data-verification="ollama-notice"]')
            return manager?.getAttribute('aria-busy') === 'false' &&
              copy instanceof HTMLButtonElement &&
              document.querySelector('.ollama-inventory-count')
                ?.textContent?.trim() === 'Showing 4 of 4 models' &&
              notice?.textContent?.includes('Copied material-embed:latest') === true
          })()`,
          'copied Ollama model'
        )

        await clickEnabledSelector(
          '[data-verification="ollama-model-row"][data-model="material-gallery-copy:latest"]'
        )
        await waitFor(
          `document.querySelector('[data-verification="ollama-model-row"][data-model="material-gallery-copy:latest"]')?.getAttribute('aria-pressed') === 'true' &&
           document.querySelector('.ollama-details-state') === null`,
          'selected copied Ollama model'
        )
        await clickEnabledSelector('[data-verification="ollama-load"]')
        await waitFor(
          `(() => {
            const row = document.querySelector(
              '[data-verification="ollama-model-row"][data-model="material-gallery-copy:latest"]'
            )
            const notice = document.querySelector('[data-verification="ollama-notice"]')
            return document.querySelector('[data-verification="ollama-manager"]')
                ?.getAttribute('aria-busy') === 'false' &&
              row?.querySelector('.ollama-running-badge') !== null &&
              notice?.textContent?.includes('Loaded material-gallery-copy:latest') === true
          })()`,
          'loaded copied Ollama model'
        )
        await clickEnabledSelector('[data-verification="ollama-unload"]')
        await waitFor(
          `(() => {
            const row = document.querySelector(
              '[data-verification="ollama-model-row"][data-model="material-gallery-copy:latest"]'
            )
            const notice = document.querySelector('[data-verification="ollama-notice"]')
            return document.querySelector('[data-verification="ollama-manager"]')
                ?.getAttribute('aria-busy') === 'false' &&
              row?.querySelector('.ollama-running-badge') === null &&
              notice?.textContent?.includes('Unloaded material-gallery-copy:latest') === true
          })()`,
          'unloaded copied Ollama model'
        )

        await clickEnabledSelector('[data-verification="ollama-delete"]')
        await waitFor(
          `document.querySelector('[data-verification="ollama-delete-dialog"][role="alertdialog"]') !== null &&
           document.activeElement === document.querySelector('[data-verification="ollama-delete-confirm"]')`,
          'focused Ollama delete confirmation'
        )
        await clickEnabledSelector(
          '[data-verification="ollama-delete-confirm"]'
        )
        await waitFor(
          `(() => {
            const notice = document.querySelector('[data-verification="ollama-notice"]')
            return document.querySelector('[data-verification="ollama-manager"]')
                ?.getAttribute('aria-busy') === 'false' &&
              document.querySelector(
                '[data-verification="ollama-model-row"][data-model="material-gallery-copy:latest"]'
              ) === null &&
              document.querySelector('[data-verification="ollama-delete-dialog"]') === null &&
              document.querySelector('.ollama-inventory-count')
                ?.textContent?.trim() === 'Showing 3 of 3 models' &&
              notice?.textContent?.includes('Deleted material-gallery-copy:latest') === true
          })()`,
          'deleted copied Ollama model'
        )

        const auditAfter = await requestOllamaFixture(
          'GET',
          '/__fixture__/audit'
        )
        const operations = (auditAfter?.events ?? [])
          .filter(event => Number(event.sequence) > auditStartSequence)
          .filter(event => event.kind === 'mutation')
          .map(event => event.operation)
        for (const expected of [
          'pull-start',
          'pull-cancelled',
          'copy',
          'load',
          'unload',
          'delete',
        ]) {
          if (!operations.includes(expected)) {
            fail(
              `Ollama UI exercise did not record ${expected}: ${JSON.stringify(
                operations
              )}`
            )
          }
        }

        const finalReset = await requestOllamaFixture(
          'POST',
          '/__fixture__/reset',
          {}
        )
        assertBaseOllamaFixtureState(finalReset, 'final reset')
        await setInput('[data-verification="ollama-pull-name"]', '')
        await setInput('[data-verification="ollama-filter"]', '')
        await setSelect('[data-verification="ollama-scope"]', 'all')
        await clickEnabledSelector('[data-verification="ollama-refresh"]')
        await waitFor(managerReady, 'refreshed canonical Ollama inventory')
        await clickEnabledSelector(
          '[data-verification="ollama-model-row"][data-model="material-chat:7b"]'
        )

        await waitFor(
          `(() => {
            const manager = document.querySelector('[data-verification="ollama-manager"]')
            const preferences = document.querySelector('#preferences')
            const rows = [...document.querySelectorAll(
              '[data-verification="ollama-model-row"]'
            )]
            const details = document.querySelector('[data-verification="ollama-details"]')
            const refresh = document.querySelector('[data-verification="ollama-refresh"]')
            const managerBounds = manager?.getBoundingClientRect()
            const preferencesBounds = preferences?.getBoundingClientRect()
            const contained = bounds => bounds !== undefined &&
              bounds.width > 0 && bounds.height > 0 &&
              bounds.left >= -0.5 && bounds.top >= -0.5 &&
              bounds.right <= window.innerWidth + 0.5 &&
              bounds.bottom <= window.innerHeight + 0.5
            return manager?.getAttribute('aria-busy') === 'false' &&
              refresh instanceof HTMLButtonElement && !refresh.disabled &&
              refresh.textContent.trim() === 'Refresh' &&
              document.querySelector('.ollama-health-indicator.is-connected') !== null &&
              document.querySelector('[data-verification="ollama-endpoint-status"]')
                ?.textContent?.trim() === 'Connected' &&
              document.querySelector('.ollama-endpoint-metrics')?.textContent
                ?.includes('0.12.6') === true &&
              document.querySelector('.ollama-inventory-count')
                ?.textContent?.trim() === 'Showing 3 of 3 models' &&
              JSON.stringify(rows.map(row => row.getAttribute('data-model'))) ===
                JSON.stringify([
                  'material-chat:7b',
                  'material-embed:latest',
                  'material-vision:3b'
                ]) &&
              rows[0]?.getAttribute('aria-pressed') === 'true' &&
              rows[0]?.querySelector('.ollama-running-badge') !== null &&
              details?.textContent?.includes('material-chat:7b') === true &&
              details?.textContent?.includes('7B') === true &&
              details?.textContent?.includes('Q4_K_M') === true &&
              details?.textContent?.includes('completion') === true &&
              details?.textContent?.includes('tools') === true &&
              document.querySelector('.ollama-details-state') === null &&
              document.querySelector('[data-verification="ollama-notice"]') === null &&
              document.querySelector('[data-verification="ollama-pull-progress"]') === null &&
              document.querySelector('[data-verification="ollama-delete-dialog"]') === null &&
              document.querySelector('[data-verification="ollama-filter"]')?.value === '' &&
              document.querySelector('[data-verification="ollama-scope"]')?.value === 'all' &&
              document.body.classList.contains('theme-dark') &&
              localStorage.getItem('theme') === 'dark' &&
              window.innerWidth === 1452 && window.innerHeight === 1001 &&
              contained(managerBounds) && contained(preferencesBounds) &&
              document.documentElement.scrollWidth <= window.innerWidth + 1 &&
              document.body.scrollWidth <= window.innerWidth + 1
          })()`,
          'settled unclipped dark Ollama manager overview',
          30000
        )
        await evaluate(`(() => {
          for (const node of document.querySelectorAll(
            '#preferences .tab-container, #preferences .copilot-tab-content'
          )) {
            node.scrollTop = 0
            node.scrollLeft = 0
          }
          return true
        })()`)
        await evaluate(
          `new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve(true))))`
        )
        await waitFor(
          `(() => {
            const dialog = document.querySelector('#preferences')
            const refresh = document.querySelector('[data-verification="ollama-refresh"]')
            const scrollers = [...document.querySelectorAll(
              '#preferences .tab-container, #preferences .copilot-tab-content'
            )]
            const activeFiniteAnimations = dialog
              ?.getAnimations({ subtree: true })
              .filter(animation => {
                const iterations = animation.effect?.getTiming().iterations ?? 1
                return iterations !== Infinity &&
                  (animation.pending || animation.playState === 'running')
              }) ?? []
            return refresh instanceof HTMLButtonElement &&
              !refresh.disabled && refresh.textContent.trim() === 'Refresh' &&
              scrollers.every(node => node.scrollTop === 0 && node.scrollLeft === 0) &&
              activeFiniteAnimations.length === 0
          })()`,
          'post-scroll stable Ollama capture surface'
        )
        await parkPointer()
      }
    )
  } finally {
    await closeAllDialogs().catch(() => undefined)
    const dark = await evaluate(
      `document.body.classList.contains('theme-dark')`
    ).catch(() => false)
    if (dark) {
      await setThemeThroughToggle('system')
      await setThemeThroughToggle('light')
    }
    await restoreCaptureViewport()
  }
})

scene('settings-automation', async () => {
  await captureSettingsTab('Automation', 'material-automation')
})

scene('settings-history', async () => {
  await ensureRepository()
  await menuEvent('show-settings-history')
  await waitFor(
    `document.querySelector('.versioned-store-history-diff') !== null`,
    'loaded Settings history diff'
  )
  await maskSettingsHistoryPrivatePaths()
  await parkPointer()
  await capture('settings-history-manager')
  await closeAllDialogs()
})

scene('sparse-checkout', async () => {
  await ensureRepository()
  await menuEvent('manage-sparse-checkout')
  await waitFor(
    `document.querySelector('.sparse-checkout-panel')?.getAttribute('aria-busy') === 'false'`,
    'loaded Sparse Checkout panel'
  )
  await maskSparseCheckoutRepositoryPath()
  await parkPointer()
  await capture('material-sparse-checkout')
  await closeAllDialogs()
})

scene('gitignore-manager', async () => {
  await ensureRepository()
  await menuEvent('manage-gitignore')
  await sleep(1500)
  await parkPointer()
  await capture('material-gitignore-manager')
  await closeAllDialogs()
})

scene('branch-rules', async () => {
  await ensureRepository()
  await menuEvent('inspect-branch-rules')
  await waitFor(
    `document.querySelector('.branch-rules-panel')?.getAttribute('aria-busy') === 'false'`,
    'effective branch rules load',
    20000
  )
  const useful = await evaluate(`(() => {
    const panel = document.querySelector('.branch-rules-panel')
    if (!(panel instanceof HTMLElement)) return false
    const text = panel.textContent ?? ''
    return !/not supported|sign in to inspect|could not inspect|network error/i.test(text) &&
      panel.querySelector('.branch-rules-card, .branch-rules-empty') !== null
  })()`)
  if (!useful) {
    fail(
      'Effective branch rules did not reach a populated deterministic state.'
    )
  }
  await parkPointer()
  await capture('material-effective-branch-rules')
  await closeAllDialogs()
})

scene('repository-tools', async () => {
  await ensureRepository()
  await menuEvent('show-repository-tools')
  await waitFor(
    `document.querySelector('.repository-tools-sidebar') !== null`,
    'Repository Tools sidebar'
  )
  await maskRepositoryToolsIntroduction()
  await parkPointer()
  await capture('material-repository-tools')
})

scene('repository-tools-scroll', async () => {
  await ensureRepository()
  await menuEvent('show-repository-tools')
  await waitFor(
    `document.querySelector('.repository-tools-sidebar') !== null`,
    'Repository Tools sidebar'
  )
  await maskRepositoryToolsIntroduction()
  await setViewport(960, 420)
  const scrolled = await evaluate(`(() => {
    const scroller = document.querySelector('.repository-tools-functions')
    if (!(scroller instanceof HTMLElement)) return false
    scroller.scrollTop = scroller.scrollHeight
    return scroller.scrollTop > 0
  })()`)
  if (!scrolled) {
    fail('Repository Tools function list did not expose a scroll range.')
  }
  await sleep(700)
  await capture('material-repository-tools-scroll')
  await restoreCaptureViewport()
})

scene('error-notice', async () => {
  if (fixturePath === null) {
    fail('Lock-file recovery requires a disposable fixture path.')
  }
  await ensureRepository()
  await menuEvent('show-changes')
  const originalBranch = execFileSync(
    'git',
    ['-C', fixturePath, 'rev-parse', '--abbrev-ref', 'HEAD'],
    { encoding: 'utf8' }
  ).trim()
  const recoveryBranch = 'gallery/stale-lock-evidence'
  if (originalBranch === recoveryBranch) {
    fail('Stale-lock evidence branch unexpectedly owns the starting fixture.')
  }
  execFileSync(
    'git',
    ['-C', fixturePath, 'checkout', '--quiet', '-B', recoveryBranch],
    { stdio: 'ignore' }
  )
  await evaluate(`require('electron').ipcRenderer.emit('focus'), true`)
  await waitFor(
    `document.querySelector('.commit-button')?.textContent?.includes(${JSON.stringify(
      recoveryBranch
    )}) === true`,
    'unprotected stale-lock evidence branch'
  )
  await setInput(
    '[role="group"][aria-label="Create commit"] input[placeholder="Summary (required)"]',
    'Verify stale lock recovery'
  )
  await waitFor(
    `document.querySelector('.commit-button') instanceof HTMLButtonElement && !document.querySelector('.commit-button').disabled && document.querySelector('.commit-button').getAttribute('aria-disabled') !== 'true'`,
    'enabled stale-lock commit action'
  )

  const lockPath = path.join(fixturePath, '.git', 'index.lock')
  fs.writeFileSync(lockPath, 'stale Desktop Material verification lock\n', {
    flag: 'wx',
  })
  const staleTime = new Date(Date.now() - 120_000)
  fs.utimesSync(lockPath, staleTime, staleTime)

  await clickEnabledSelector('.commit-button')
  await waitFor(
    `[...document.querySelectorAll('.error-notice button')].some(button => button.textContent.trim() === 'Remove lock file')`,
    'real stale-lock recovery notice',
    30000
  )
  const noticeText = await evaluate(
    `document.querySelector('.error-notice')?.textContent ?? ''`
  )
  if (!/lock file/i.test(noticeText) || !/Remove lock file/.test(noticeText)) {
    fail(`Stale-lock notice did not name its recovery: ${noticeText}`)
  }

  await clickText('Remove lock file', { within: '.error-notice' })
  await waitFor(
    `document.querySelector('.error-notice [aria-label="Confirm lock file removal"]') !== null`,
    'explicit stale-lock removal confirmation'
  )
  const confirmationText = await evaluate(
    `document.querySelector('.error-notice-lock-confirmation')?.textContent ?? ''`
  )
  if (!/Stop all Git and IDE processes/.test(confirmationText)) {
    fail(
      `Stale-lock confirmation omitted its process warning: ${confirmationText}`
    )
  }
  await sleep(700)
  await parkPointer()
  await capture('material-error-notice')

  await clickText('Confirm remove lock file', { within: '.error-notice' })
  const removalDeadline = Date.now() + 15000
  while (fs.existsSync(lockPath) && Date.now() < removalDeadline) {
    await sleep(250)
  }
  if (fs.existsSync(lockPath)) {
    fail('Remove lock file did not remove the verified stale index.lock.')
  }
  await closeAllDialogs()
  execFileSync(
    'git',
    ['-C', fixturePath, 'checkout', '--quiet', originalBranch],
    { stdio: 'ignore' }
  )
  execFileSync(
    'git',
    ['-C', fixturePath, 'branch', '--delete', '--force', recoveryBranch],
    { stdio: 'ignore' }
  )
  await evaluate(`require('electron').ipcRenderer.emit('focus'), true`)
  await waitFor(
    `document.querySelector('.commit-button')?.textContent?.includes(${JSON.stringify(
      originalBranch
    )}) === true`,
    'restored canonical fixture branch'
  )
})

scene('responsive-overflow', async () => {
  await ensureRepository()
  await menuEvent('show-changes')
  await setViewport(640, 480)
  await sleep(900)
  await capture('material-responsive-overflow-fixed')
  await restoreCaptureViewport()
})

/** Switch to a GitHub section by its rail label and capture. */
async function captureSection(railLabel, name, settleMs = 2500) {
  await ensureRepository()
  const done = await evaluate(`(() => {
    const rail = document.querySelector('nav.repository-rail')
    if (!rail) return false
    const target = [...rail.querySelectorAll('button')].find(button => {
      const label = button.getAttribute('aria-label') ?? button.textContent ?? ''
      return label.trim() === ${JSON.stringify(railLabel)}
    })
    if (!target) return false
    target.click()
    return true
  })()`)
  if (!done) {
    fail(`Rail section ${railLabel} not found.`)
  }
  await sleep(settleMs)
  await parkPointer()
  if (name !== null) {
    await capture(name)
  }
}

scene('releases', async () => {
  await captureSection('Releases', 'material-github-releases', 3500)
})

scene('issues', async () => {
  await captureSection('Issues', null, 3500)
  await waitFor(
    `(() => {
      const rows = [...document.querySelectorAll('.github-issue-row')]
      const count = document.querySelector('.github-issues-list-panel .github-issues-panel-heading span')
      const loading = document.querySelector('.github-issues-busy, .github-issues-metadata-note')
      const errors = [...document.querySelectorAll('.github-issues-error, [role="alert"]')]
        .filter(node => (node.textContent ?? '').trim().length > 0)
      return rows.length === 1 && count?.textContent?.trim() === '1 on page 1' &&
        loading === null && errors.length === 0
    })()`,
    'populated GitHub Issues list and metadata',
    30000
  )
  await clickSelector('.github-issue-row')
  await waitFor(
    `(() => {
      const detail = document.querySelector('.github-issue-detail')
      const title = detail?.querySelector('#selected-issue-title')
      const comments = detail?.querySelectorAll('.github-issue-comment-list article')
      const controls = [...(detail?.querySelectorAll('button') ?? [])]
        .map(button => button.textContent?.trim())
      const errors = [...document.querySelectorAll('.github-issues-error, [role="alert"]')]
        .filter(node => (node.textContent ?? '').trim().length > 0)
      return detail instanceof HTMLElement &&
        title?.textContent?.trim() === 'Verify the complete Windows gallery before publication' &&
        comments?.length === 1 &&
        ['Open on GitHub', 'Edit', 'Add comment', 'Close issue']
          .every(label => controls.includes(label)) &&
        errors.length === 0
    })()`,
    'selected issue detail, lifecycle controls, and comments',
    30000
  )
  await evaluate(`(() => {
    const detail = document.querySelector('.github-issue-detail')
    if (!(detail instanceof HTMLElement)) return false
    detail.scrollTop = 0
    return detail.scrollTop === 0
  })()`)
  await sleep(700)
  await parkPointer()
  await capture('material-github-issues')
})

scene('provider-triage', async () => {
  await ensureRepository()
  const clicked = await evaluate(`(() => {
    const item = document.querySelector('#triage-tab')
    const tab = item?.closest('button[role="tab"]')
    if (!(tab instanceof HTMLButtonElement) || tab.disabled) return false
    tab.click()
    return true
  })()`)
  if (!clicked) {
    fail('The exact Triage repository tab was unavailable.')
  }
  await waitFor(
    `(() => {
      const item = document.querySelector('#triage-tab')
      const tab = item?.closest('button[role="tab"]')
      const view = document.querySelector('main.provider-triage-view')
      const channels = view?.querySelectorAll('.provider-triage-channel.ready')
      const items = view?.querySelectorAll('.provider-triage-item')
      const heading = view?.querySelector('.provider-triage-results-heading strong')
      const bounds = view?.getBoundingClientRect()
      return tab?.getAttribute('aria-selected') === 'true' &&
        view instanceof HTMLElement &&
        channels?.length === 2 &&
        items?.length === 2 &&
        heading?.textContent?.trim() === '2 of 2 work items' &&
        bounds !== undefined && bounds.width > 0 && bounds.height > 0 &&
        bounds.left >= 0 && bounds.top >= 0 &&
        bounds.right <= window.innerWidth && bounds.bottom <= window.innerHeight
    })()`,
    'settled exact provider triage surface',
    30000
  )
  await parkPointer()
  await capture('material-provider-triage')
})

scene('api-explorer', async () => {
  await captureSection('API', 'material-github-api-explorer', 3000)
})

scene('api-app-functions', async () => {
  await captureSection('API', null, 2000)
  const filterModeSelector =
    '.filter-mode-control[data-search-surface-id="github-api-rest"] .filter-mode-button'
  for (let attempt = 0; attempt < 3; attempt++) {
    const mode = await evaluate(
      `document.querySelector(${JSON.stringify(
        filterModeSelector
      )})?.getAttribute('aria-label') ?? ''`
    )
    if (mode.startsWith('Filter mode: Substring')) {
      break
    }
    await clickSelector(filterModeSelector)
    await sleep(150)
  }
  await waitFor(
    `document.querySelector(${JSON.stringify(
      filterModeSelector
    )})?.getAttribute('aria-label')?.startsWith('Filter mode: Substring') === true`,
    'substring API operation filter mode'
  )
  await setInput('[data-search-surface-id="github-api-rest"]', 'repos/get')
  await waitFor(
    `document.querySelector('.github-api-explorer-operation-create[data-operation-id="repos/get"]') !== null`,
    'repository function source operation'
  )
  await clickSelector(
    '.github-api-explorer-operation-create[data-operation-id="repos/get"]'
  )
  await waitFor(
    `document.querySelector('#github-api-explorer-rest-panel select')?.value === 'GET' && [...document.querySelectorAll('#github-api-explorer-rest-panel label')].find(label => label.firstChild?.textContent?.trim() === 'REST API path')?.querySelector('input')?.value === 'repos/material-fixture-owner/material-fixture'`,
    'repository request template'
  )
  await setInput('.github-api-function-editor input[pattern]', 'get_repository')
  await setInput(
    '.github-api-function-editor input[maxlength="500"]',
    'Inspect the bound repository metadata without changing it.'
  )
  await clickText('Add current request as function', {
    within: '.github-api-functions',
  })
  await waitFor(
    `(() => {
      const functions = document.querySelector('.github-api-functions')
      const card = [...(functions?.querySelectorAll('[aria-label="Named API functions"] > li') ?? [])]
        .find(node => node.querySelector('strong')?.textContent?.trim() === 'get_repository')
      return functions?.querySelector(':scope > header > span')?.textContent?.trim() === '1 for this repository' &&
        card?.querySelector('code')?.textContent?.trim() === 'repos/get' &&
        card?.querySelector('header > span.read')?.textContent?.trim() === 'read' &&
        !functions?.querySelector('[role="alert"]')?.textContent?.trim()
    })()`,
    'saved repository API function'
  )
  await evaluate(`(() => {
    const functions = document.querySelector(
      '.github-api-functions [aria-label="Named API functions"]'
    )
    if (functions instanceof HTMLElement) {
      functions.scrollIntoView({ block: 'center' })
      return true
    }
    const explorer = document.querySelector('.github-api-explorer')
    if (explorer instanceof HTMLElement) explorer.scrollTop = explorer.scrollHeight
    return true
  })()`)
  await sleep(900)
  await parkPointer()
  await capture('material-api-app-functions')
})

scene('actions-runs', async () => {
  await captureSection('Actions', null, 3500)
  await parkPointer()
  await capture('material-actions-pagination')
})

scene('actions-load-more', async () => {
  await captureSection('Actions', null, 2500)
  await clickText('Load more runs', { optional: true })
  await sleep(2500)
  await evaluate(`(() => {
    const main = document.querySelector('.actions-view')
    if (main instanceof HTMLElement) main.scrollTop = main.scrollHeight
    return true
  })()`)
  await sleep(600)
  await parkPointer()
  await capture('material-actions-pagination-headless')
})

const InspectorRunTitle =
  'Actions run inspector verifies attempt navigation, page-two job recovery, deployment review, fork approval, and zero sideways scrolling'
const InspectorSentinelJobTitle =
  'Page-two current-attempt Windows packaging sentinel with an intentionally long responsive name'

function requireInspectorFixture() {
  const values = [
    ready?.workflowRunCount,
    ready?.inspectorJobCount,
    ready?.inspectorCurrentJobSentinelId,
  ]
  if (!values.every(Number.isSafeInteger)) {
    fail('Actions inspector scenes require the deterministic provider fixture.')
  }
}

async function openInspectorRun() {
  requireInspectorFixture()
  await captureSection('Actions', null, 2500)
  await waitFor(
    `document.querySelector('.actions-run-pagination')?.textContent?.includes('50 loaded of ${ready.workflowRunCount} workflow runs') === true || document.querySelector('.actions-run-pagination')?.textContent?.includes('${ready.workflowRunCount} loaded of ${ready.workflowRunCount} workflow runs') === true`,
    'bounded or complete Actions run inventory',
    30000
  )
  const runInventoryComplete = await evaluate(
    `document.querySelector('.actions-run-pagination')?.textContent?.includes('${ready.workflowRunCount} loaded of ${ready.workflowRunCount} workflow runs') === true`
  )
  if (!runInventoryComplete) {
    await clickText('Load more runs', { within: '.actions-view' })
  }
  await waitFor(
    `document.querySelector('.actions-run-pagination')?.textContent?.includes('${ready.workflowRunCount} loaded of ${ready.workflowRunCount} workflow runs') === true`,
    'complete Actions run inventory',
    30000
  )
  const opened = await evaluate(`(() => {
    const title = ${JSON.stringify(InspectorRunTitle)}
    const list = document.querySelector('.actions-run-list')
    const run = [...document.querySelectorAll('button.actions-run-select')]
      .find(button => button.textContent?.includes(title))
    if (!(list instanceof HTMLElement) || !(run instanceof HTMLElement)) return false
    const listBounds = list.getBoundingClientRect()
    const runBounds = run.getBoundingClientRect()
    list.scrollTop += runBounds.top - listBounds.top -
      Math.max(0, (list.clientHeight - runBounds.height) / 2)
    const content = document.querySelector('.actions-content')
    if (content instanceof HTMLElement) content.scrollTop = 0
    run.click()
    return true
  })()`)
  if (!opened) {
    fail('The exact Actions inspector run is absent after pagination.')
  }
  await waitFor(
    `document.querySelector('.actions-run-details')?.textContent?.includes(${JSON.stringify(
      InspectorRunTitle
    )}) === true && (document.querySelector('.actions-job-pagination')?.textContent?.includes('50 loaded of ${
      ready.inspectorJobCount
    } jobs for attempt 2') === true || document.querySelector('.actions-job-pagination')?.textContent?.includes('${
      ready.inspectorJobCount
    } loaded of ${ready.inspectorJobCount} jobs for attempt 2') === true)`,
    'Actions inspector attempt-two jobs',
    30000
  )
  await evaluate(`new Promise(resolve => {
    const stabilize = () => {
      const content = document.querySelector('.actions-content')
      const list = document.querySelector('.actions-run-list')
      const run = [...document.querySelectorAll('button.actions-run-select')]
        .find(button => button.textContent?.includes(${JSON.stringify(
          InspectorRunTitle
        )}))
      const details = document.querySelector('.actions-run-details')
      if (content instanceof HTMLElement) content.scrollTop = 0
      if (details instanceof HTMLElement) details.scrollTop = 0
      if (list instanceof HTMLElement && run instanceof HTMLElement) {
        const listBounds = list.getBoundingClientRect()
        const runBounds = run.getBoundingClientRect()
        list.scrollTop += runBounds.top - listBounds.top -
          Math.max(0, (list.clientHeight - runBounds.height) / 2)
      }
    }
    stabilize()
    requestAnimationFrame(() => requestAnimationFrame(() => {
      stabilize()
      resolve(true)
    }))
  })`)
  await sleep(520)
  await waitFor(
    `(() => {
      const content = document.querySelector('.actions-content')
      const list = document.querySelector('.actions-run-list')
      const run = [...document.querySelectorAll('button.actions-run-select')]
        .find(button => button.textContent?.includes(${JSON.stringify(
          InspectorRunTitle
        )}))
      const details = document.querySelector('.actions-run-details')
      const title = details?.querySelector('.actions-details-header h2')
      const pagination = details?.querySelector('.actions-job-pagination')
      const cards = details?.querySelectorAll('.actions-job-card')
      if (!(content instanceof HTMLElement) || !(list instanceof HTMLElement) ||
          !(run instanceof HTMLButtonElement) || !(details instanceof HTMLElement) ||
          !(pagination instanceof HTMLElement)) return false
      const contentBounds = content.getBoundingClientRect()
      const listBounds = list.getBoundingClientRect()
      const runBounds = run.getBoundingClientRect()
      const detailsBounds = details.getBoundingClientRect()
      const titleBounds = title?.getBoundingClientRect()
      const paginationBounds = pagination.getBoundingClientRect()
      const inside = (inner, outer) =>
        inner.width > 0 && inner.height > 0 &&
        inner.left >= outer.left - 0.5 && inner.top >= outer.top - 0.5 &&
        inner.right <= outer.right + 0.5 && inner.bottom <= outer.bottom + 0.5
      return content.scrollTop === 0 && details.scrollTop === 0 &&
        contentBounds.height > 300 &&
        title?.textContent?.trim() === ${JSON.stringify(InspectorRunTitle)} &&
        run.getAttribute('aria-pressed') === 'true' &&
        pagination.textContent?.includes('50 loaded of ${
          ready.inspectorJobCount
        } jobs for attempt 2') === true &&
        cards?.length === 50 &&
        details.querySelector('.actions-loading, .actions-job-error, [role="alert"]') === null &&
        inside(runBounds, listBounds) && inside(titleBounds, detailsBounds) &&
        inside(listBounds, contentBounds) && inside(detailsBounds, contentBounds) &&
        inside(paginationBounds, detailsBounds) &&
        contentBounds.left >= 0 && contentBounds.top >= 0 &&
        contentBounds.right <= window.innerWidth && contentBounds.bottom <= window.innerHeight
    })()`,
    'visible Actions inspector split panes',
    30000
  )
}

async function loadInspectorPageTwo() {
  requireInspectorFixture()
  for (let attempt = 0; attempt < 3; attempt++) {
    const complete = await evaluate(
      `document.querySelector('.actions-job-pagination')?.textContent?.includes('${ready.inspectorJobCount} loaded of ${ready.inspectorJobCount} jobs for attempt 2') === true`
    )
    if (complete) {
      break
    }
    await clickText('Load more jobs', { within: '.actions-run-details' })
    await waitFor(
      `document.querySelector('.actions-job-pagination')?.textContent?.includes('${ready.inspectorJobCount} loaded of ${ready.inspectorJobCount} jobs for attempt 2') === true || (document.querySelector('.actions-job-error') !== null && [...document.querySelectorAll('.actions-run-details button')].some(button => button.textContent.trim() === 'Load more jobs' && !button.disabled))`,
      'Actions inspector page-two response',
      30000
    )
  }
  await waitFor(
    `document.querySelector('.actions-job-pagination')?.textContent?.includes('${
      ready.inspectorJobCount
    } loaded of ${
      ready.inspectorJobCount
    } jobs for attempt 2') === true && [...document.querySelectorAll('.actions-job-card')].some(card => card.textContent?.includes(${JSON.stringify(
      InspectorSentinelJobTitle
    )}))`,
    'Actions inspector page-two sentinel',
    30000
  )
}

scene('actions-run-details', async () => {
  await openInspectorRun()
  await parkPointer()
  await capture('material-actions-jobs-pagination')
})

scene('actions-caches', async () => {
  await captureSection('Actions', null, 2000)
  await clickText('Caches', { within: '.actions-view' })
  await sleep(2500)
  await parkPointer()
  await capture('material-actions-cache-manager')
})

/** Click a tab-strip / app-bar control by aria-label prefix. */
async function clickAria(prefix, options = {}) {
  const clicked = await evaluate(`(() => {
    const target = [...document.querySelectorAll('button')].find(button =>
      (button.getAttribute('aria-label') ?? '').startsWith(${JSON.stringify(
        prefix
      )}))
    if (!target) return false
    target.click()
    return true
  })()`)
  if (!clicked && options.optional !== true) {
    fail(`No control labeled ${prefix}.`)
  }
  return clicked
}

scene('notification-center', async () => {
  await ensureRepository()
  await clickAria('Notifications')
  await sleep(1500)
  await parkPointer()
  await capture('material-notification-center')
})

scene('notification-bulk', async () => {
  await ensureRepository()
  const open = await evaluate(
    `document.querySelector('[class*=notification-centre], [class*=notification-center]') !== null`
  )
  if (!open) {
    await clickAria('Notifications')
    await sleep(1200)
  }
  await clickText('Local', { optional: true })
  await sleep(900)
  await evaluate(`(() => {
    for (const box of [...document.querySelectorAll(
      '[class*=notification] input[type=checkbox]'
    )].slice(0, 2)) {
      box.click()
    }
    return true
  })()`)
  await sleep(700)
  await parkPointer()
  await capture('material-notification-bulk-actions')
})

scene('notification-github', async () => {
  await ensureRepository()
  const open = await evaluate(
    `document.querySelector('[class*=notification-centre], [class*=notification-center]') !== null`
  )
  if (!open) {
    await clickAria('Notifications')
    await sleep(1200)
  }
  await clickText('GitHub', { optional: true })
  await sleep(1500)
  await parkPointer()
  await capture('material-github-notifications')
  await pressEscape(1)
})

scene('tab-search', async () => {
  await ensureRepository()
  await clickAria('Search tabs')
  await waitFor(
    `document.querySelector('.tab-search-result-copy > span') !== null`,
    'tab search result'
  )
  await evaluate(`(() => {
    for (const path of document.querySelectorAll('.tab-search-result-copy > span')) {
      path.textContent = 'C:\\Synthetic\\material-fixture'
      path.removeAttribute('title')
    }
    return true
  })()`)
  await parkPointer()
  await capture('material-tab-search')
  await pressEscape(1)
})

scene('tab-arrange', async () => {
  await ensureRepository()
  await clickAria('Arrange tabs')
  await sleep(1000)
  await parkPointer()
  await capture('material-tab-arrange')
  await pressEscape(1)
})

scene('tab-style', async () => {
  await ensureRepository()
  await contextMenuSelector('.repository-tab.active .repository-tab-label')
  await waitForPrivacySafeAnchoredEditor('tab-title owner appearance editor')
  await sleep(900)
  await parkPointer()
  await capture('material-tab-appearance-word')
  await closeAllDialogs()
})

scene('app-identity', async () => {
  await ensureRepository()

  const original = await evaluate(`(async () => {
    const root = document.querySelector('#desktop-app-container')
    const node = root?.querySelector('*')
    const fiberKey = node && Object.keys(node).find(key =>
      key.startsWith('__reactFiber$') ||
      key.startsWith('__reactInternalInstance$')
    )
    let fiber = fiberKey ? node[fiberKey] : null
    let app = null
    for (let depth = 0; fiber && depth < 120; depth++, fiber = fiber.return) {
      if (
        fiber.stateNode?.props?.appStore &&
        fiber.stateNode?.props?.repositoryTabsStore &&
        fiber.stateNode?.props?.dispatcher
      ) {
        app = fiber.stateNode
        break
      }
    }
    if (!app) return { appFound: false }

    const { appStore, dispatcher, repositoryTabsStore } = app.props
    const appearance = appStore.getState().appearanceCustomization
    const activeTab = repositoryTabsStore.getActiveTab()
    if (!activeTab) return { appFound: true, activeTabFound: false }

    const originalIdentity = appearance.appIdentity
    const originalFavorite = activeTab.isFavorite === true
    const expectedIdentity = ${JSON.stringify(GalleryAppIdentity)}
    await dispatcher.setAppearanceCustomization({
      ...appearance,
      appIdentity: { ...originalIdentity, ...expectedIdentity },
    })
    await repositoryTabsStore.setTabFavorite(activeTab.id, true)

    const appliedIdentity = appStore.getState().appearanceCustomization.appIdentity
    const appliedTab = repositoryTabsStore.getState().tabs.find(
      tab => tab.id === activeTab.id
    )
    return {
      appFound: true,
      activeTabFound: true,
      activeTabId: activeTab.id,
      originalIdentity,
      originalFavorite,
      identityMatches: Object.entries(expectedIdentity).every(
        ([key, value]) => appliedIdentity[key] === value
      ),
      favoriteApplied: appliedTab?.isFavorite === true,
      displayName: appliedIdentity.displayName,
      logo: appliedIdentity.logo,
    }
  })()`)
  if (
    original?.appFound !== true ||
    original?.activeTabFound !== true ||
    original?.identityMatches !== true ||
    original?.favoriteApplied !== true
  ) {
    fail(
      `Unable to persist the deterministic app identity/favorite state: ${JSON.stringify(
        {
          appFound: original?.appFound,
          activeTabFound: original?.activeTabFound,
          identityMatches: original?.identityMatches,
          favoriteApplied: original?.favoriteApplied,
          displayName: original?.displayName,
          logo: original?.logo,
        }
      )}`
    )
  }

  await waitFor(
    `(() => {
      const brand = document.querySelector(
        '#desktop-app-title-bar [data-customization-surface="app-identity"] .app-brand'
      )
      const tab = document.querySelector(
        '.repository-tab.active.favorite[role="tab"][aria-selected="true"]'
      )
      const favorite = tab?.querySelector('.repository-tab-favorite')
      return brand?.textContent?.trim() === ${JSON.stringify(
        GalleryAppIdentity.displayName
      )} && favorite?.getAttribute('aria-pressed') === 'true'
    })()`,
    'live customized app identity and favorite repository tab'
  )

  const reloadProofId = crypto.randomBytes(12).toString('hex')
  const reloadProof = Object.freeze({
    storageKey: `desktop-material:gallery:app-identity:${reloadProofId}`,
    nonce: crypto.randomBytes(32).toString('hex'),
    sentinelKey: `__desktopMaterialGalleryReload_${reloadProofId}`,
  })
  const armedReloadProof = await evaluate(`(() => {
    const storageKey = ${JSON.stringify(reloadProof.storageKey)}
    const nonce = ${JSON.stringify(reloadProof.nonce)}
    const sentinelKey = ${JSON.stringify(reloadProof.sentinelKey)}
    sessionStorage.setItem(storageKey, nonce)
    Object.defineProperty(window, sentinelKey, {
      configurable: true,
      enumerable: false,
      value: nonce,
    })
    return {
      nonceStored: sessionStorage.getItem(storageKey) === nonce,
      sentinelPresent:
        Object.prototype.hasOwnProperty.call(window, sentinelKey) &&
        window[sentinelKey] === nonce,
      timeOrigin: performance.timeOrigin,
    }
  })()`)
  if (
    armedReloadProof?.nonceStored !== true ||
    armedReloadProof?.sentinelPresent !== true ||
    typeof armedReloadProof?.timeOrigin !== 'number'
  ) {
    fail(
      `Unable to arm the app identity renderer-reload proof: ${JSON.stringify(
        armedReloadProof
      )}`
    )
  }
  const beforeReloadTimeOrigin = armedReloadProof.timeOrigin
  await evaluate('window.location.reload(), true')
  await sleep(2500)
  await client.send('Runtime.enable')
  await waitFor(
    `document.querySelector('nav.repository-rail') !== null &&
      document.querySelector('#desktop-app-title-bar .app-brand') !== null`,
    'repository workspace after app-identity renderer reload',
    25000
  )

  // Reload can replay provider notices, sheets, hover state, or a prior section.
  // Re-establish the closed Changes workspace before accepting the frame.
  await resetSceneState('restored app-identity workspace')
  await waitFor(
    `(() => {
      const root = document.querySelector('#desktop-app-container')
      if (!(root instanceof HTMLElement)) return false
      const activeFiniteAnimations = root
        .getAnimations({ subtree: true })
        .filter(animation => {
          const iterations = Number(animation.effect?.getTiming().iterations ?? 1)
          return iterations !== Infinity &&
            animation.playState !== 'finished' &&
            animation.playState !== 'idle'
        })
      return activeFiniteAnimations.length === 0
    })()`,
    'stable restored app-identity workspace'
  )
  await evaluate(`new Promise(resolve =>
    requestAnimationFrame(() => requestAnimationFrame(() => resolve(true)))
  )`)
  await parkPointer()

  const restored = await evaluate(`(() => {
    const root = document.querySelector('#desktop-app-container')
    const node = root?.querySelector('*')
    const fiberKey = node && Object.keys(node).find(key =>
      key.startsWith('__reactFiber$') ||
      key.startsWith('__reactInternalInstance$')
    )
    let fiber = fiberKey ? node[fiberKey] : null
    let app = null
    for (let depth = 0; fiber && depth < 120; depth++, fiber = fiber.return) {
      if (
        fiber.stateNode?.props?.appStore &&
        fiber.stateNode?.props?.repositoryTabsStore
      ) {
        app = fiber.stateNode
        break
      }
    }
    if (!app) return { appFound: false }

    const expectedIdentity = ${JSON.stringify(GalleryAppIdentity)}
    const identity = app.props.appStore.getState().appearanceCustomization.appIdentity
    const activeTab = app.props.repositoryTabsStore.getActiveTab()
    const brandContainer = document.querySelector(
      '#desktop-app-title-bar [data-customization-surface="app-identity"]'
    )
    const brand = brandContainer?.querySelector('.app-brand')
    const logo = brandContainer?.querySelector('.app-brand-logo')
    const tab = document.querySelector(
      '.repository-tab.active.favorite[role="tab"][aria-selected="true"]'
    )
    const favorite = tab?.querySelector('.repository-tab-favorite')
    const changes = document.getElementById('changes-tab')?.closest('[role="tab"]')
    const bounds = element => {
      if (!(element instanceof HTMLElement)) return null
      const rect = element.getBoundingClientRect()
      return {
        width: rect.width,
        height: rect.height,
        withinViewport:
          rect.width > 0 && rect.height > 0 &&
          rect.left >= 0 && rect.top >= 0 &&
          rect.right <= window.innerWidth && rect.bottom <= window.innerHeight,
      }
    }
    return {
      appFound: true,
      identityMatches: Object.entries(expectedIdentity).every(
        ([key, value]) => identity[key] === value
      ),
      activeTabMatches: activeTab?.id === ${JSON.stringify(
        original.activeTabId
      )},
      favoriteRestored: activeTab?.isFavorite === true,
      displayName: identity.displayName,
      logo: identity.logo,
      brandText: brand?.textContent?.trim() ?? null,
      brandBounds: bounds(brandContainer),
      logoBounds: bounds(logo),
      tabBounds: bounds(tab),
      favoritePressed: favorite?.getAttribute('aria-pressed') === 'true',
      changesSelected: changes?.getAttribute('aria-selected') === 'true',
      editorClosed:
        document.querySelector('.app-identity-section') === null &&
        document.querySelector('.anchored-appearance-editor') === null &&
        document.querySelector('#preferences') === null,
      sessionNonceMatches:
        sessionStorage.getItem(${JSON.stringify(
          reloadProof.storageKey
        )}) === ${JSON.stringify(reloadProof.nonce)},
      globalSentinelAbsent: !Object.prototype.hasOwnProperty.call(
        window,
        ${JSON.stringify(reloadProof.sentinelKey)}
      ),
      navigationType:
        performance.getEntriesByType('navigation')[0]?.type ?? null,
      timeOrigin: performance.timeOrigin,
    }
  })()`)
  if (
    restored?.appFound !== true ||
    restored?.identityMatches !== true ||
    restored?.activeTabMatches !== true ||
    restored?.favoriteRestored !== true ||
    restored?.displayName !== GalleryAppIdentity.displayName ||
    restored?.logo !== GalleryAppIdentity.logo ||
    restored?.brandText !== GalleryAppIdentity.displayName ||
    restored?.brandBounds?.withinViewport !== true ||
    restored?.logoBounds?.withinViewport !== true ||
    restored?.tabBounds?.withinViewport !== true ||
    restored?.favoritePressed !== true ||
    restored?.changesSelected !== true ||
    restored?.editorClosed !== true ||
    restored?.sessionNonceMatches !== true ||
    restored?.globalSentinelAbsent !== true ||
    !(restored?.timeOrigin > beforeReloadTimeOrigin)
  ) {
    fail(
      `Restored app identity workspace failed its persistence/geometry gate: ${JSON.stringify(
        restored
      )}`
    )
  }
  await assertNoSceneLeaks('restored app-identity workspace')
  process.stdout.write(
    `APP_IDENTITY_RELOAD ${JSON.stringify({
      displayName: restored.displayName,
      logo: restored.logo,
      favorite: restored.favoriteRestored,
      sessionNonceSurvived: restored.sessionNonceMatches,
      globalSentinelAbsent: restored.globalSentinelAbsent,
      navigationType: restored.navigationType,
      beforeReloadTimeOrigin,
      restoredTimeOrigin: restored.timeOrigin,
    })}\n`
  )
  await capture('material-app-identity-workspace')

  const cleanup = await evaluate(`(async () => {
    const root = document.querySelector('#desktop-app-container')
    const node = root?.querySelector('*')
    const fiberKey = node && Object.keys(node).find(key =>
      key.startsWith('__reactFiber$') ||
      key.startsWith('__reactInternalInstance$')
    )
    let fiber = fiberKey ? node[fiberKey] : null
    let app = null
    for (let depth = 0; fiber && depth < 120; depth++, fiber = fiber.return) {
      if (
        fiber.stateNode?.props?.appStore &&
        fiber.stateNode?.props?.repositoryTabsStore &&
        fiber.stateNode?.props?.dispatcher
      ) {
        app = fiber.stateNode
        break
      }
    }
    if (!app) return { appFound: false }

    const { appStore, dispatcher, repositoryTabsStore } = app.props
    const currentAppearance = appStore.getState().appearanceCustomization
    const originalIdentity = ${JSON.stringify(original.originalIdentity)}
    await dispatcher.setAppearanceCustomization({
      ...currentAppearance,
      appIdentity: originalIdentity,
    })
    const originalTab = repositoryTabsStore.getState().tabs.find(
      tab => tab.id === ${JSON.stringify(original.activeTabId)}
    )
    if (
      originalTab &&
      (originalTab.isFavorite === true) !== ${JSON.stringify(
        original.originalFavorite
      )}
    ) {
      await repositoryTabsStore.setTabFavorite(
        originalTab.id,
        ${JSON.stringify(original.originalFavorite)}
      )
    }
    const restoredIdentity = appStore.getState().appearanceCustomization.appIdentity
    const restoredTab = repositoryTabsStore.getState().tabs.find(
      tab => tab.id === ${JSON.stringify(original.activeTabId)}
    )
    sessionStorage.removeItem(${JSON.stringify(reloadProof.storageKey)})
    return {
      appFound: true,
      identityRestored:
        JSON.stringify(restoredIdentity) === JSON.stringify(originalIdentity),
      tabFound: restoredTab !== undefined,
      favoriteRestored:
        (restoredTab?.isFavorite === true) === ${JSON.stringify(
          original.originalFavorite
        )},
      reloadProofRemoved:
        sessionStorage.getItem(${JSON.stringify(
          reloadProof.storageKey
        )}) === null,
    }
  })()`)
  if (
    cleanup?.appFound !== true ||
    cleanup?.identityRestored !== true ||
    cleanup?.tabFound !== true ||
    cleanup?.favoriteRestored !== true ||
    cleanup?.reloadProofRemoved !== true
  ) {
    fail(`App identity scene cleanup failed: ${JSON.stringify(cleanup)}`)
  }
})

scene('multi-window-menu', async () => {
  await ensureRepository()
  await clickAria('Open a repository in a new tab')
  const selectedRepository =
    '#foldout-container .repository-list [role="option"][aria-selected="true"][data-context-menu-owner="true"]'
  await waitFor(
    `document.querySelector(${JSON.stringify(selectedRepository)}) !== null`,
    'selected repository row in the repository sheet'
  )
  await contextMenuSelector(selectedRepository)
  await waitFor(
    `(() => {
      const menu = document.querySelector('.material-context-menu[role="menu"]')
      const item = [...(menu?.querySelectorAll('button.context-menu-item') ?? [])]
        .find(button =>
          button.querySelector('.context-menu-item-label')?.textContent?.trim() ===
            'Open in new window'
        )
      if (!(menu instanceof HTMLElement) || !(item instanceof HTMLButtonElement)) {
        return false
      }
      const menuBounds = menu.getBoundingClientRect()
      const itemBounds = item.getBoundingClientRect()
      return !item.disabled && item.getAttribute('aria-disabled') !== 'true' &&
        menuBounds.width > 0 && menuBounds.height > 0 &&
        itemBounds.width > 0 && itemBounds.height > 0 &&
        itemBounds.left >= menuBounds.left && itemBounds.top >= menuBounds.top &&
        itemBounds.right <= menuBounds.right && itemBounds.bottom <= menuBounds.bottom &&
        menuBounds.left >= 0 && menuBounds.top >= 0 &&
        menuBounds.right <= window.innerWidth && menuBounds.bottom <= window.innerHeight
    })()`,
    'enabled Open in new window repository command'
  )
  await parkPointer()
  await capture('material-multi-window-menu')
  await closeAllDialogs()
})

scene('toolbar-overflow', async () => {
  await ensureRepository()
  await menuEvent('show-changes')
  await setViewport(720, 687)
  await sleep(900)
  ;(await clickAria('More', { optional: true })) ||
    (await clickText('More', { optional: true }))
  await sleep(900)
  await parkPointer()
  await capture('material-toolbar-overflow')
  await pressEscape(1)
  await restoreCaptureViewport()
})

scene('scale-200', async () => {
  await ensureRepository()
  await menuEvent('show-changes')
  await setViewport(640, 480)
  for (let index = 0; index < 5; index++) {
    await menuEvent('zoom-in')
  }
  await waitFor(
    `Number(localStorage.getItem('zoom-factor')) === 2 && localStorage.getItem('zoom-auto-fit-enabled') === '1' && require('electron').webFrame.getZoomFactor() >= 0.5 && require('electron').webFrame.getZoomFactor() < 2`,
    'requested 200% base with fitted renderer scale'
  )
  await sleep(1200)
  await capture('material-scale-200-autofit')
  await menuEvent('zoom-reset')
  await restoreCaptureViewport()
})

scene('history-power-tools', async () => {
  await ensureRepository()
  await menuEvent('show-history')
  await sleep(1200)
  await ensureCommitList()
  await evaluate(`(() => {
    const graph = document.querySelector('[aria-label*=graph i], [aria-label*=ancestry i]')
    if (graph instanceof HTMLElement) graph.click()
    return true
  })()`)
  await setInput('input[placeholder*="Search commits"]', 'submodules')
  await waitFor(
    `(() => {
      const commits = [...document.querySelectorAll('#commit-list .commit')]
      const summaries = commits.map(commit =>
        commit.querySelector('.summary')?.textContent?.trim() ?? ''
      )
      const historyText = document.querySelector('#history')?.textContent ?? ''
      return commits.length === 1 &&
        summaries[0] === 'Add deterministic initialized and dormant submodules' &&
        !historyText.includes('No matching commits')
    })()`,
    'positive submodule history search result',
    30000
  )
  await sleep(700)
  await parkPointer()
  await capture('material-history-power-tools')
  await setInput('input[placeholder*="Search commits"]', '')
})

/** Open Repository settings on a named tab. */
async function openRepositorySettingsTab(tabLabel) {
  await ensureRepository()
  await menuEvent('show-repository-settings')
  await waitFor(
    `document.querySelector('#repository-settings') !== null`,
    'repository settings'
  )
  await sleep(700)
  if (tabLabel !== null) {
    await clickText(tabLabel, { within: '#repository-settings' })
    await sleep(900)
  }
}

function ensureRepositoryFolderScanFixture() {
  if (fixturePath === null) {
    fail('Repository-folder detection requires a disposable fixture path.')
  }
  const root = path.join(
    runRoot ?? path.dirname(fixturePath),
    'repository-folder-scan'
  )
  for (const relativePath of ['design-system', 'tools/release-kit']) {
    const repositoryPath = path.join(root, relativePath)
    fs.mkdirSync(repositoryPath, { recursive: true })
    if (!fs.existsSync(path.join(repositoryPath, '.git'))) {
      execFileSync('git', ['init', '--quiet', repositoryPath], {
        windowsHide: true,
        stdio: 'pipe',
      })
    }
  }
  return root
}

async function installSyntheticDirectoryPicker(directoryPath) {
  const installed = await evaluate(`(() => {
    const ipc = require('electron').ipcRenderer
    if (window.__galleryOriginalIpcInvoke !== undefined) return false
    window.__galleryOriginalIpcInvoke = ipc.invoke
    ipc.invoke = function(channel, ...args) {
      if (channel === 'show-open-dialog') {
        return Promise.resolve(${JSON.stringify(directoryPath)})
      }
      return window.__galleryOriginalIpcInvoke.call(this, channel, ...args)
    }
    return true
  })()`)
  if (!installed) {
    fail('Unable to install the synthetic directory-picker response.')
  }
}

async function restoreSyntheticDirectoryPicker() {
  await evaluate(`(() => {
    const ipc = require('electron').ipcRenderer
    if (window.__galleryOriginalIpcInvoke === undefined) return false
    ipc.invoke = window.__galleryOriginalIpcInvoke
    delete window.__galleryOriginalIpcInvoke
    return true
  })()`)
}

scene('repository-folder-detection', async () => {
  const scanRoot = ensureRepositoryFolderScanFixture()
  await ensureRepository()
  await menuEvent('add-local-repository')
  await waitFor(
    `document.querySelector('#add-existing-repository') !== null`,
    'Add local repository dialog'
  )
  await installSyntheticDirectoryPicker(scanRoot)
  try {
    await clickText('Auto-detect repositories...', {
      within: '#add-existing-repository',
    })
    await waitFor(
      `document.querySelector('.repository-folder-scan-results')?.textContent?.includes('Found 2 Git repositories') === true`,
      'two detected synthetic repositories'
    )
  } finally {
    await restoreSyntheticDirectoryPicker()
  }

  // The scan is real; only replace the private disposable root in the visible
  // textbox so published pixels stay deterministic and privacy-safe.
  await evaluate(`(() => {
    const input = document.querySelector(
      '#add-existing-repository input[type="text"]'
    )
    if (!(input instanceof HTMLInputElement)) return false
    const setter = Object.getOwnPropertyDescriptor(
      window.HTMLInputElement.prototype,
      'value'
    ).set
    setter.call(input, 'C:\\Synthetic\\Repository Fleet')
    return true
  })()`)
  await sleep(700)
  await parkPointer()
  await capture('material-repository-folder-detection')
  await closeAllDialogs()
})

scene('remote-manager', async () => {
  await openRepositorySettingsTab('Remote')
  await waitFor(
    `document.querySelector('.remotes-manager') !== null && document.querySelector('.remote-row') !== null && document.querySelector('.remote-manager-results') !== null`,
    'populated Remote Manager'
  )
  const remoteState = await evaluate(`(() => {
    const settings = document.querySelector('#repository-settings')
    return {
      error: settings?.querySelector('[role="alert"], .add-remote-error')?.textContent ?? '',
      text: settings?.textContent ?? '',
    }
  })()`)
  if (
    remoteState?.error.trim() !== '' ||
    /could not inspect/i.test(remoteState?.text ?? '')
  ) {
    fail(
      `Remote Manager did not reach a useful state: ${JSON.stringify(
        remoteState
      )}`
    )
  }
  await parkPointer()
  await capture('material-remote-manager')
  await closeAllDialogs()
})

scene('ssh-docker-deploy', async () => {
  await openRepositorySettingsTab('Remote')
  await evaluate(`(() => {
    const deployControl = document.querySelector(
      '#repository-settings .ssh-deploy-on-push'
    )
    if (!(deployControl instanceof HTMLElement)) return false
    deployControl.scrollIntoView({ block: 'center' })
    return true
  })()`)
  await sleep(1200)
  await parkPointer()
  await capture('material-ssh-docker-deploy')
  await closeAllDialogs()
})

scene('add-submodule', async () => {
  await openRepositorySettingsTab('Submodules')
  await clickText('Add submodule…', { within: '#repository-settings' })
  await waitFor(
    `document.querySelector('.add-submodule-dialog') !== null`,
    'Add Submodule dialog'
  )
  await clickText('Create remote', { within: '.add-submodule-dialog' })
  await waitFor(
    `document.querySelector('.add-submodule-create-remote-content') !== null`,
    'Create remote submodule source'
  )
  const remoteFields = await evaluate(`(() =>
    [...document.querySelectorAll('.add-submodule-create-remote-fields input[type="text"]')]
      .map(input => input.getAttribute('aria-label') ?? input.labels?.[0]?.textContent?.trim() ?? '')
  )()`)
  if (!Array.isArray(remoteFields) || remoteFields.length < 2) {
    fail(
      `Create remote fields are unavailable: ${JSON.stringify(remoteFields)}`
    )
  }
  await setInput(
    '.add-submodule-create-remote-fields input[type="text"]:nth-of-type(1)',
    'material-widget'
  ).catch(async () => {
    const set = await evaluate(`(() => {
      const input = document.querySelectorAll(
        '.add-submodule-create-remote-fields input[type="text"]'
      )[0]
      if (!(input instanceof HTMLInputElement)) return false
      const setter = Object.getOwnPropertyDescriptor(
        window.HTMLInputElement.prototype,
        'value'
      ).set
      setter.call(input, 'material-widget')
      input.dispatchEvent(new Event('input', { bubbles: true }))
      return true
    })()`)
    if (!set) fail('Unable to enter the new remote repository name.')
  })
  const descriptionEntered = await evaluate(`(() => {
    const input = document.querySelectorAll(
      '.add-submodule-create-remote-fields input[type="text"]'
    )[1]
    if (!(input instanceof HTMLInputElement)) return false
    const setter = Object.getOwnPropertyDescriptor(
      window.HTMLInputElement.prototype,
      'value'
    ).set
    setter.call(input, 'Synthetic dependency for the Material workspace')
    input.dispatchEvent(new Event('input', { bubbles: true }))
    return true
  })()`)
  if (!descriptionEntered) {
    fail('Unable to enter the new remote repository description.')
  }
  await setInput(
    '.add-submodule-dialog input[placeholder="vendor/repository"]',
    'vendor/material-widget'
  )
  await waitFor(
    `!document.querySelector('.add-submodule-dialog')?.textContent?.includes('Checking that the destination is safe and empty')`,
    'Add Submodule path validation'
  )
  await waitFor(
    `[...document.querySelectorAll('.add-submodule-dialog button')].some(button => button.textContent.trim() === 'Create and add submodule' && !button.disabled)`,
    'valid Create remote and add review'
  )
  const providerMutations =
    providerRequestLog !== null && fs.existsSync(providerRequestLog)
      ? fs
          .readFileSync(providerRequestLog, 'utf8')
          .split(/\r?\n/)
          .filter(line => /POST .*\/(?:user|orgs\/[^/]+)\/repos/.test(line))
          .length
      : 0
  await parkPointer()
  await capture('add-submodule-dialog')
  if (providerRequestLog !== null && fs.existsSync(providerRequestLog)) {
    const after = fs
      .readFileSync(providerRequestLog, 'utf8')
      .split(/\r?\n/)
      .filter(line => /POST .*\/(?:user|orgs\/[^/]+)\/repos/.test(line)).length
    if (after !== providerMutations) {
      fail('Create remote review mutated the provider before submission.')
    }
  }
  await closeAllDialogs()
})

scene('repository-submodule-management', async () => {
  await openRepositorySettingsTab('Submodules')
  await waitFor(
    `document.querySelector('.submodule-appearance-preview .submodule-context-back') !== null`,
    'Submodule Back appearance owner'
  )
  await shiftF10Selector(
    '.submodule-appearance-preview .submodule-context-back'
  )
  await waitForPrivacySafeAnchoredEditor(
    'Submodule Back owner appearance editor'
  )
  await sleep(900)
  await parkPointer()
  await capture('material-repository-submodule-management')
  await closeAllDialogs()
})

async function getPersistentRepositoryState() {
  return await evaluate(`(async () => {
    const repositories = await new Promise((resolve, reject) => {
      const open = indexedDB.open('Database')
      open.onerror = () => reject(open.error ?? new Error('database open failed'))
      open.onsuccess = () => {
        const database = open.result
        if (!database.objectStoreNames.contains('repositories')) {
          database.close()
          reject(new Error('repositories store is unavailable'))
          return
        }
        const transaction = database.transaction('repositories', 'readonly')
        const request = transaction.objectStore('repositories').count()
        request.onerror = () => reject(request.error ?? new Error('count failed'))
        request.onsuccess = () => {
          const count = request.result
          transaction.oncomplete = () => database.close()
          resolve(count)
        }
      }
    })
    return {
      repositories,
      tabs: document.querySelectorAll('.repository-tab[role="tab"]').length,
    }
  })()`)
}

scene('submodule-context', async () => {
  await ensureRepository()
  const before = await getPersistentRepositoryState()
  await menuEvent('show-repository-tools')
  await waitFor(
    `document.querySelector('[data-hub-tool="submodule-manager"]') !== null`,
    'Submodule Manager tool'
  )
  await maskRepositoryToolsIntroduction()
  await clickSelector('[data-hub-tool="submodule-manager"]')
  await clickText('Open submodule manager', {
    within: 'main.repository-tools',
  })
  await waitFor(
    `document.querySelector('#submodule-manager .submodule-row') !== null`,
    'Submodule Manager rows',
    30000
  )
  const opened = await evaluate(`(() => {
    const action = [...document.querySelectorAll(
      '#submodule-manager .submodule-open-repository'
    )].find(button =>
      button.getAttribute('aria-disabled') !== 'true' && !button.disabled
    )
    if (!(action instanceof HTMLElement)) return false
    action.click()
    return true
  })()`)
  if (!opened) {
    fail('No checked-out submodule was available to open temporarily.')
  }
  await waitFor(
    `document.querySelector('.submodule-repository-context') !== null`,
    'temporary submodule repository context',
    30000
  )
  const openedState = await getPersistentRepositoryState()
  if (
    openedState.repositories !== before.repositories ||
    openedState.tabs !== before.tabs
  ) {
    fail(
      `Temporary submodule polluted persisted state: ${JSON.stringify({
        before,
        openedState,
      })}`
    )
  }
  await waitFor(
    `document.querySelector('.submodule-context-back')?.getAttribute('aria-label')?.length > 0`,
    'named Back control'
  )
  await waitFor(
    `(() => {
      const context = document.querySelector('.submodule-repository-context')
      const sidebar = document.querySelector('#repository-sidebar')
      const interstitial = document.querySelector('.changes-interstitial')
      const heading = interstitial?.querySelector('h1')
      if (!(context instanceof HTMLElement) || !(sidebar instanceof HTMLElement) ||
          !(interstitial instanceof HTMLElement)) return false
      const activeFiniteAnimations = [context, sidebar, interstitial]
        .flatMap(root => root.getAnimations({ subtree: true }))
        .filter((animation, index, animations) => animations.indexOf(animation) === index)
        .filter(animation => {
          const iterations = animation.effect?.getTiming().iterations ?? 1
          return iterations !== Infinity &&
            (animation.pending || animation.playState === 'running')
        })
      return document.querySelector('#submodule-manager') === null &&
        heading?.textContent?.trim() === 'No local changes' &&
        activeFiniteAnimations.length === 0
    })()`,
    'settled temporary submodule Changes surface',
    30000
  )
  await evaluate(
    `new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve(true))))`
  )
  await parkPointer()
  await capture('material-submodule-context')

  await clickSelector('.submodule-context-back')
  await waitFor(
    `document.querySelector('.submodule-repository-context') === null`,
    'return to persisted parent repository',
    30000
  )
  const returnedState = await getPersistentRepositoryState()
  if (
    returnedState.repositories !== before.repositories ||
    returnedState.tabs !== before.tabs
  ) {
    fail(
      `Returning from the temporary submodule changed persisted state: ${JSON.stringify(
        { before, returnedState }
      )}`
    )
  }
})

scene('logo-studio', async () => {
  await ensureRepository()
  await menuEvent('choose-repository')
  await waitFor(
    `document.querySelector('.repository-list-logo-appearance-target') !== null`,
    'repository logo owner'
  )
  await contextMenuSelector('.repository-list-logo-appearance-target')
  await waitForPrivacySafeAnchoredEditor('repository logo owner editor')
  await waitFor(
    `document.querySelector('.repository-logo-studio') !== null`,
    'repository logo studio'
  )
  await waitFor(
    `(() => {
      const editor = document.querySelector('.repository-logo-anchored-editor')
      const content = editor?.querySelector('.anchored-appearance-editor-content')
      const studio = editor?.querySelector('.repository-logo-studio')
      const workbenchScroll = studio?.querySelector('.repository-logo-editor-scroll')
      const mount = editor?.closest('.anchored-appearance-editor-mount')
      const popover = editor?.closest('.popover-component')
      const foldoutContainer = document.querySelector('#foldout-container')
      const foldout = foldoutContainer?.querySelector('.foldout')
      const heading = studio?.querySelector('#repository-logo-studio-heading')
      const preview = studio?.querySelector('[aria-label^="Live logo preview for "]')
      const presets = studio?.querySelector('[aria-label="Logo presets"]')
      if (!(editor instanceof HTMLElement) || !(content instanceof HTMLElement) ||
          !(studio instanceof HTMLElement) || !(workbenchScroll instanceof HTMLElement) ||
          !(mount instanceof HTMLElement) ||
          !(popover instanceof HTMLElement) || !(foldoutContainer instanceof HTMLElement) ||
          !(foldout instanceof HTMLElement) || !(heading instanceof HTMLElement) ||
          !(preview instanceof HTMLElement) || !(presets instanceof HTMLElement)) return false
      const headingText = heading.firstChild
      if (!(headingText instanceof Text) || headingText.data !== 'Custom repository logo') {
        return false
      }
      const firstGlyphRange = document.createRange()
      firstGlyphRange.setStart(headingText, 0)
      firstGlyphRange.setEnd(headingText, 1)
      const firstGlyphBounds = firstGlyphRange.getBoundingClientRect()
      const popoverBounds = popover.getBoundingClientRect()
      const foldoutBounds = foldout.getBoundingClientRect()
      const studioBounds = studio.getBoundingClientRect()
      const contentStyle = getComputedStyle(content)
      const workbenchScrollStyle = getComputedStyle(workbenchScroll)
      const contentOwnsScroll = contentStyle.overflowY === 'auto' &&
        content.scrollHeight > content.clientHeight + 1
      const workbenchOwnsScroll = ['auto', 'scroll'].includes(workbenchScrollStyle.overflowY) &&
        workbenchScroll.scrollHeight > workbenchScroll.clientHeight + 1
      const namedControls = [heading, preview, presets].map(element =>
        element.getBoundingClientRect()
      )
      return editor.closest('.foldout') === null &&
        mount.parentElement === foldoutContainer &&
        popoverBounds.width > foldoutBounds.width &&
        popoverBounds.height > 0 &&
        popoverBounds.left >= 0 && popoverBounds.top >= 0 &&
        popoverBounds.right <= window.innerWidth && popoverBounds.bottom <= window.innerHeight &&
        content.clientHeight >= Math.min(320, window.innerHeight - 200) &&
        contentOwnsScroll && !workbenchOwnsScroll &&
        workbenchScrollStyle.overflowY === 'visible' &&
        content.scrollLeft === 0 && workbenchScroll.scrollLeft === 0 &&
        studioBounds.width > 0 && studioBounds.height > 0 &&
        studioBounds.left >= popoverBounds.left && studioBounds.right <= popoverBounds.right &&
        firstGlyphBounds.width > 0 && firstGlyphBounds.height > 0 &&
        firstGlyphBounds.left >= studioBounds.left + 4 &&
        firstGlyphBounds.right <= studioBounds.right &&
        namedControls.every(bounds => bounds.width > 0 && bounds.height > 0)
    })()`,
    'unclipped repository logo studio portal'
  )
  const scrollReceipt = await evaluate(`(() => {
    const content = document.querySelector(
      '.repository-logo-anchored-editor .anchored-appearance-editor-content'
    )
    if (!(content instanceof HTMLElement)) return null
    const maximum = content.scrollHeight - content.clientHeight
    content.scrollTop = content.scrollHeight
    const reachedBottom = maximum > 0 && content.scrollTop >= maximum - 1
    const reached = content.scrollTop
    content.scrollTop = 0
    return { maximum, reached, reachedBottom, restored: content.scrollTop === 0 }
  })()`)
  if (
    scrollReceipt === null ||
    scrollReceipt.reachedBottom !== true ||
    scrollReceipt.restored !== true
  ) {
    fail(
      `Repository logo studio scroll range is unreachable: ${JSON.stringify(
        scrollReceipt
      )}`
    )
  }
  await waitFor(
    `document.querySelector('.repository-logo-anchored-editor .anchored-appearance-editor-content')?.scrollTop === 0`,
    'restored repository logo studio scroll position'
  )
  await sleep(900)
  await parkPointer()
  await capture('material-repository-logo-studio')
  await closeAllDialogs()
})

scene('stash-manager', async () => {
  await ensureRepository()
  fs.writeFileSync(
    path.join(fixturePath, 'stash-note.md'),
    '# Stash fixture\n\nStashed change for the manager surface.\n'
  )
  await menuEvent('show-changes')
  await sleep(1800)
  await menuEvent('stash-all-changes')
  await sleep(2500)
  await menuEvent('show-stashed-changes')
  await sleep(1500)
  await parkPointer()
  await capture('material-stash-manager')
})

scene('rebase-review', async () => {
  await ensureRepository()
  await menuEvent('rebase-branch')
  await waitFor(
    `document.querySelector('#choose-branch') !== null`,
    'rebase branch chooser'
  )
  await clickPointerSelector(
    '#choose-branch [role="option"][aria-label^="origin/main"]'
  )
  await waitFor(
    `document.querySelector('.rebase-route') !== null && document.querySelector('.rebase-ahead-behind') !== null && document.querySelector('.rebase-commit-preview') !== null`,
    'bounded rebase review'
  )
  await parkPointer()
  await capture('material-rebase-review')
  await closeAllDialogs()
})

function ensurePullRequestMergeBase() {
  if (fixturePath === null) {
    fail('Pull-request scenes require a disposable fixture path.')
  }
  try {
    execFileSync(
      'git',
      ['-C', fixturePath, 'merge-base', 'HEAD', 'origin/main'],
      {
        windowsHide: true,
        stdio: 'ignore',
      }
    )
  } catch {
    execFileSync(
      'git',
      [
        '-C',
        fixturePath,
        'fetch',
        '--deepen=1',
        '--no-write-fetch-head',
        'origin',
      ],
      { windowsHide: true, stdio: 'ignore' }
    )
  }
  execFileSync(
    'git',
    ['-C', fixturePath, 'merge-base', 'HEAD', 'origin/main'],
    {
      windowsHide: true,
      stdio: 'ignore',
    }
  )
  const shallow = execFileSync(
    'git',
    ['-C', fixturePath, 'rev-parse', '--is-shallow-repository'],
    { encoding: 'utf8', windowsHide: true }
  ).trim()
  if (shallow !== 'true') {
    fail(
      'Pull-request merge-base preparation unexpectedly removed the shallow boundary.'
    )
  }
}

scene('pull-request-compose', async () => {
  ensurePullRequestMergeBase()
  await ensureRepository()
  await menuEvent('preview-pull-request')
  await waitFor(
    `document.querySelector('.open-pull-request') !== null`,
    'pull-request comparison'
  )
  // Always reselect the base. Account hydration may replace the repository
  // model while the remembered label remains origin/main, leaving an old
  // commit selection behind until the branch selection contract runs again.
  await clickSelector('.open-pull-request .popover-dropdown-component > button')
  await waitFor(
    `document.querySelector('.popover-dropdown-popover [role="option"][aria-label^="origin/main"]') !== null`,
    'origin/main pull-request base option'
  )
  await clickPointerSelector(
    '.popover-dropdown-popover [role="option"][aria-label^="origin/main"]'
  )
  await waitFor(
    `document.querySelector('.pull-request-files-changed') !== null && /Merge [1-9][0-9]* commits? into\\s+base:origin[/]main\\s+from\\s+feature[/]material-verification/i.test(document.querySelector('.base-branch-details')?.textContent ?? '')`,
    'non-empty feature-to-origin/main pull-request comparison',
    30000
  )
  const comparison = await evaluate(`(() => ({
    text: document.querySelector('.open-pull-request')?.textContent ?? '',
    added: document.querySelector('.lines-added')?.textContent ?? '',
    removed: document.querySelector('.lines-deleted')?.textContent ?? '',
    errors: [...document.querySelectorAll('.open-pull-request [role="alert"]')]
      .map(node => node.textContent ?? ''),
  }))()`)
  if (
    /There are no changes|Could not find a default branch/i.test(
      comparison?.text ?? ''
    ) ||
    (comparison?.errors ?? []).some(value => value.trim() !== '') ||
    (/^0\s/.test(comparison?.added ?? '') &&
      /^0\s/.test(comparison?.removed ?? ''))
  ) {
    fail(`Pull-request comparison is not useful: ${JSON.stringify(comparison)}`)
  }
  await waitFor(
    `(() => {
      const clean = document.querySelector('.open-pull-request .pr-merge-status-clean')
      return clean instanceof HTMLElement &&
        clean.textContent?.includes('Able to merge.') === true &&
        document.querySelector('.open-pull-request .pr-merge-status-loading') === null &&
        document.querySelector('.open-pull-request .pr-merge-status-invalid') === null &&
        document.querySelector('.open-pull-request .pr-merge-status-conflicts') === null
    })()`,
    'stable clean pull-request mergeability',
    30000
  )
  await parkPointer()
  await capture('material-native-pull-request')
  await closeAllDialogs()
})

scene('pull-request-open', async () => {
  ensurePullRequestMergeBase()
  await ensureRepository()
  const pullRequestPath = /\/repos\/[^/]+\/[^/]+\/pulls(?:\?|$)/
  const before = countProviderRequests('POST', pullRequestPath)
  const expectedPullRequestNumber = 73 + before
  const expectedPullRequestReceipt = `Pull request #${expectedPullRequestNumber} created`
  await menuEvent('preview-pull-request')
  await waitFor(
    `document.querySelector('.open-pull-request') !== null`,
    'pull-request comparison before native creation'
  )
  await clickSelector('.open-pull-request .popover-dropdown-component > button')
  await waitFor(
    `document.querySelector('.popover-dropdown-popover [role="option"][aria-label^="origin/main"]') !== null`,
    'origin/main native pull-request base option'
  )
  await clickPointerSelector(
    '.popover-dropdown-popover [role="option"][aria-label^="origin/main"]'
  )
  await waitFor(
    `document.querySelector('.pull-request-files-changed') !== null && /Merge [1-9][0-9]* commits? into\\s+base:origin[/]main\\s+from\\s+feature[/]material-verification/i.test(document.querySelector('.base-branch-details')?.textContent ?? '')`,
    'non-empty comparison before native pull-request creation',
    30000
  )
  await clickText('Create pull request', { within: '.open-pull-request' })
  await waitFor(
    `document.querySelector('#create-github-pull-request') !== null || document.querySelector('#push-branch-commits') !== null`,
    'native pull-request creation handoff'
  )
  if (
    await evaluate(`document.querySelector('#push-branch-commits') !== null`)
  ) {
    await clickText('Create without pushing', {
      within: '#push-branch-commits',
    })
  }
  await waitFor(
    `document.querySelector('#create-github-pull-request') !== null`,
    'native pull-request dialog'
  )
  await waitFor(
    `document.querySelector('#create-github-pull-request select[aria-label="Base branch"]') !== null && document.querySelector('#create-github-pull-request input[aria-label="Title"]') !== null && !document.querySelector('#create-github-pull-request')?.textContent?.includes('Native pull request creation is unavailable')`,
    'available native pull-request form',
    30000
  )
  await setSelect(
    '#create-github-pull-request select[aria-label="Base branch"]',
    'main'
  )
  await setInput(
    '#create-github-pull-request input[aria-label="Title"]',
    'Verify deterministic Windows desktop material evidence'
  )
  await setInput(
    '#create-github-pull-request textarea[aria-label="Description (optional)"]',
    'Synthetic provider-backed completion proof for the reviewed feature-to-main route.'
  )
  // Button exposes creation-context loading through aria-disabled rather than
  // the native disabled property, so activate only its settled instance.
  await clickTextWhenEnabled('Review pull request', {
    within: '#create-github-pull-request',
    timeout: 30000,
  })
  await waitFor(
    `document.querySelector('.create-github-pull-request-review') !== null && document.querySelector('.create-github-pull-request-context')?.textContent?.includes('feature/material-verification → main') === true`,
    'reviewed feature-to-main pull-request route'
  )
  const afterReview = countProviderRequests('POST', pullRequestPath)
  if (afterReview !== before) {
    fail(
      `Reviewing the native pull request sent ${
        afterReview - before
      } provider POSTs before confirmation.`
    )
  }
  await clickText('Create pull request', {
    within: '#create-github-pull-request',
  })
  await waitFor(
    `document.querySelector('.create-github-pull-request-success[role="status"]')?.textContent?.includes(${JSON.stringify(
      expectedPullRequestReceipt
    )}) === true`,
    'native pull-request success receipt',
    30000
  )
  const nativeState = await evaluate(`(() => ({
    text: document.querySelector('#create-github-pull-request')?.textContent ?? '',
    errors: [...document.querySelectorAll('#create-github-pull-request [role="alert"]')]
      .map(node => node.textContent ?? ''),
  }))()`)
  if (
    /Native pull request creation is unavailable|upstream does not belong|There are no changes/i.test(
      nativeState?.text ?? ''
    ) ||
    (nativeState?.errors ?? []).some(value => value.trim() !== '')
  ) {
    fail(
      `Native pull-request completion failed: ${JSON.stringify(nativeState)}`
    )
  }
  const after = countProviderRequests('POST', pullRequestPath)
  if (after !== before + 1) {
    fail(
      `Native pull-request completion sent ${
        after - before
      } provider POSTs instead of exactly one.`
    )
  }
  await parkPointer()
  await capture('material-create-pull-request')
  await closeAllDialogs()
})

scene('shallow-clone-dialog', async () => {
  await ensureRepository()
  await menuEvent('clone-repository')
  await waitFor(
    `document.querySelector('dialog.clone-repository') !== null`,
    'clone dialog'
  )
  await clickText('URL', { within: 'dialog.clone-repository' })
  await sleep(700)
  await setInput(
    'dialog.clone-repository input[type="text"]',
    'http://localhost:57520/material-fixture-owner/material-fixture.git'
  )
  await sleep(1500)
  await evaluate(`(() => {
    const box = [...document.querySelectorAll(
      'dialog.clone-repository input[type=checkbox]'
    )].find(x => !x.checked)
    if (box) box.click()
    return true
  })()`)
  await sleep(900)
  await maskVisibleValue(
    'dialog.clone-repository input[placeholder="repository path"]',
    'C:\\Synthetic\\material-fixture'
  )
  await parkPointer()
  await capture('material-shallow-clone')
  // The reviewed state: depth field visible with its bounded value focused.
  await evaluate(`(() => {
    const field = [...document.querySelectorAll(
      'dialog.clone-repository input'
    )].find(x => x.value === '1')
    if (field instanceof HTMLElement) field.focus()
    return true
  })()`)
  await sleep(500)
  await capture('material-shallow-clone-safe')
  await closeAllDialogs()
})

scene('sparse-checkout-safe', async () => {
  await ensureRepository()
  await menuEvent('manage-sparse-checkout')
  await waitFor(
    `document.querySelector('.sparse-checkout-panel')?.getAttribute('aria-busy') === 'false' && document.querySelector('.sparse-checkout-editor') !== null`,
    'editable Sparse Checkout panel'
  )
  await maskSparseCheckoutRepositoryPath()
  await setInput('.sparse-checkout-editor', 'docs/')
  await waitFor(
    `document.querySelector('.sparse-checkout-editor-count')?.textContent?.trim() === '1 valid directory' && [...document.querySelectorAll('.sparse-checkout-write-button')].some(button => /^Review (enable|directory update)$/.test(button.textContent.trim()) && !button.disabled)`,
    'one valid reviewed sparse directory'
  )
  const reviewLabel = await evaluate(`(() =>
    [...document.querySelectorAll('.sparse-checkout-write-button')]
      .find(button => /^Review (enable|directory update)$/.test(button.textContent.trim()) && !button.disabled)
      ?.textContent.trim() ?? null
  )()`)
  if (reviewLabel === null) {
    fail('Sparse Checkout review action is unavailable.')
  }
  await clickText(reviewLabel, { within: '.sparse-checkout-panel' })
  await waitFor(
    `document.querySelector('.sparse-checkout-confirmation') !== null`,
    'Sparse Checkout confirmation'
  )
  await parkPointer()
  await capture('material-sparse-checkout-safe')
  await closeAllDialogs()
})

scene('pull-all', async () => {
  await ensureRepository()
  await menuEvent('choose-repository')
  await waitFor(
    `[...document.querySelectorAll('button')].some(button => button.textContent.trim() === 'Sync repositories')`,
    'repository batch-sync action'
  )
  await clickText('Sync repositories')
  await waitFor(
    `document.querySelector('#pull-all-repositories [aria-label="Repository batch review"]') !== null`,
    'repository batch review'
  )
  await clickText('Start pull', { within: '#pull-all-repositories' })
  await waitFor(
    `document.querySelector('#pull-all-repositories')?.textContent?.includes('Pull complete') === true && document.querySelector('#pull-all-repositories')?.textContent?.includes('Every repository has a final result.') === true && document.querySelector('#pull-all-repositories .pull-all-summary') !== null`,
    'completed reviewed repository sync',
    45000
  )
  await parkPointer()
  await capture('material-pull-all-account-fallback')
  await closeAllDialogs()
  await pressEscape(1)
})

scene('clone-fallback', async () => {
  await ensureRepository()
  await menuEvent('clone-repository')
  await waitFor(
    `document.querySelector('dialog.clone-repository') !== null`,
    'clone dialog'
  )
  await clickText('URL', { within: 'dialog.clone-repository' })
  await sleep(700)
  await setInput(
    'dialog.clone-repository input[type="text"]',
    'http://localhost:57520/material-fixture-owner/material-fixture.git'
  )
  await sleep(2200)
  await maskVisibleValue(
    'dialog.clone-repository input[placeholder="repository path"]',
    'C:\\Synthetic\\material-fixture'
  )
  await parkPointer()
  await capture('material-clone-account-fallback')
  await closeAllDialogs()
})

scene('regex-builder', async () => {
  await ensureRepository()
  await menuEvent('show-history')
  await sleep(1200)
  await ensureCommitList()
  await clickSelector('.history-filter-chips-toggle')
  await waitFor(
    `document.querySelector('.history-filter-chips') !== null`,
    'History filter chips'
  )
  await clickSelector('.history-regex-builder-chip')
  await waitFor(
    `document.querySelector('#regex-builder-title') !== null`,
    'Regex Builder dialog'
  )
  await evaluate(`(() => {
    const sample = document.querySelector('.regex-test-sample')
    const preview = document.querySelector('.regex-test-preview')
    if (!(sample instanceof HTMLTextAreaElement) || !(preview instanceof HTMLElement)) {
      return false
    }
    sample.scrollTop = 0
    preview.scrollTop = 0
    return true
  })()`)
  await waitFor(
    `(() => {
      const dialog = document.querySelector('.regex-builder-dialog')
      const sample = document.querySelector('.regex-test-sample')
      const preview = document.querySelector('.regex-test-preview')
      if (!(dialog instanceof HTMLElement) || !(sample instanceof HTMLTextAreaElement) ||
          !(preview instanceof HTMLElement)) return false
      const lines = sample.value.split(/\\r?\\n/)
      const hashLineIndex = lines.findIndex(line =>
        /[0-9a-f]{40}.*[0-9a-f]{7}/i.test(line)
      )
      if (hashLineIndex < 0) return false
      const hashLine = lines[hashLineIndex]
      const style = getComputedStyle(sample)
      const lineHeight = Number.parseFloat(style.lineHeight)
      const contentHeight = sample.clientHeight -
        Number.parseFloat(style.paddingTop) - Number.parseFloat(style.paddingBottom)
      const dialogBounds = dialog.getBoundingClientRect()
      const sampleBounds = sample.getBoundingClientRect()
      const previewBounds = preview.getBoundingClientRect()
      const previewText = preview.querySelector('span')?.firstChild
      if (!(previewText instanceof Text)) return false
      const hashOffset = previewText.data.indexOf(hashLine)
      if (hashOffset < 0) return false
      const hashRange = document.createRange()
      hashRange.setStart(previewText, hashOffset)
      hashRange.setEnd(previewText, hashOffset + hashLine.length)
      const hashBounds = hashRange.getBoundingClientRect()
      return Number.isFinite(lineHeight) && lineHeight > 0 &&
        sample.rows >= hashLineIndex + 1 &&
        contentHeight >= lineHeight * (hashLineIndex + 1) - 0.5 &&
        sample.scrollTop === 0 && preview.scrollTop === 0 &&
        sampleBounds.left >= dialogBounds.left && sampleBounds.right <= dialogBounds.right &&
        sampleBounds.top >= dialogBounds.top && sampleBounds.bottom <= dialogBounds.bottom &&
        hashBounds.width > 0 && hashBounds.height > 0 &&
        hashBounds.top >= previewBounds.top - 0.5 &&
        hashBounds.bottom <= previewBounds.bottom + 0.5
    })()`,
    'fully visible first regex sample hash line'
  )
  await parkPointer()
  await capture('regex-builder')
  await closeAllDialogs()
})

async function openShallowHistoryTool() {
  await ensureRepository()
  await menuEvent('show-repository-tools')
  await waitFor(
    `document.querySelector('[data-hub-tool="shallow-history"]') !== null`,
    'Shallow History tool'
  )
  await maskRepositoryToolsIntroduction()
  await clickSelector('[data-hub-tool="shallow-history"]')
  await waitFor(
    `document.querySelector('.repository-shallow-history') !== null`,
    'Shallow History panel'
  )
  await clickText('Check history status', {
    within: '.repository-shallow-history',
  })
  await waitFor(
    `document.querySelector('.repository-shallow-history')?.textContent?.includes('This repository is shallow.') === true && [...document.querySelectorAll('.repository-shallow-history button')].some(button => button.textContent.trim() === 'Review bounded deepen' && !button.disabled)`,
    'confirmed shallow repository',
    30000
  )
}

scene('history-deepen', async () => {
  await openShallowHistoryTool()
  await setInput('#repository-shallow-history-count', '1')
  await clickText('Review bounded deepen', {
    within: '.repository-shallow-history',
  })
  await waitFor(
    `[...document.querySelectorAll('.repository-shallow-history-confirmation button')].some(button => button.textContent.trim() === 'Deepen by 1 commits')`,
    'bounded deepen confirmation'
  )
  await clickText('Deepen by 1 commits', {
    within: '.repository-shallow-history-confirmation',
  })
  await waitFor(
    `document.querySelector('.repository-shallow-history')?.textContent?.includes('Fetched 1 additional commits of history from origin. The repository still has a shallow boundary.') === true`,
    'bounded deepen completion',
    45000
  )
  await parkPointer()
  await capture('material-history-deepen')
})

scene('history-deepening', async () => {
  await openShallowHistoryTool()
  await clickText('Review full history', {
    within: '.repository-shallow-history',
  })
  await waitFor(
    `[...document.querySelectorAll('.repository-shallow-history-confirmation button')].some(button => button.textContent.trim() === 'Fetch full history')`,
    'full-history confirmation'
  )
  await clickText('Fetch full history', {
    within: '.repository-shallow-history-confirmation',
  })
  await waitFor(
    `document.querySelector('.repository-shallow-history')?.textContent?.includes('Fetched full history from origin. This repository is no longer shallow.') === true`,
    'full-history completion',
    45000
  )
  const shallow = execFileSync(
    'git',
    ['-C', fixturePath, 'rev-parse', '--is-shallow-repository'],
    { encoding: 'utf8', windowsHide: true }
  ).trim()
  if (shallow !== 'false') {
    fail(`Full-history scene left the fixture shallow: ${shallow}`)
  }
  await parkPointer()
  await capture('material-history-deepening')
})

/** Ensure a workflow run's details pane is open in the Actions tab. */
async function openFirstRun(index = 0) {
  await captureSection('Actions', null, 2500)
  await waitFor(
    `document.querySelectorAll('button.actions-run-select').length > ${index}`,
    'Actions run row for artifact evidence',
    30000
  )
  const selectedTitle = await evaluate(`(() => {
    const rows = [...document.querySelectorAll('button.actions-run-select')]
    const row = rows[${index}] ?? rows[0]
    if (!(row instanceof HTMLButtonElement)) return null
    const title = row.querySelector('.actions-run-summary strong')?.textContent?.trim()
    if (!title) return null
    const openTitle = document.querySelector(
      '.actions-run-details .actions-details-header h2'
    )?.textContent?.trim()
    if (row.getAttribute('aria-pressed') !== 'true' || openTitle !== title) {
      row.click()
    }
    return title
  })()`)
  if (typeof selectedTitle !== 'string' || selectedTitle.length === 0) {
    fail('The exact Actions artifact fixture run is unavailable.')
  }
  await waitFor(
    `document.querySelector('.actions-run-details .actions-details-header h2')?.textContent?.trim() === ${JSON.stringify(
      selectedTitle
    )}`,
    'exact Actions artifact fixture run details',
    30000
  )
}

scene('actions-artifacts', async () => {
  await openFirstRun()
  await evaluate(`(() => {
    const artifacts = [...document.querySelectorAll('h2, h3, h4')]
      .find(h => /artifact/i.test(h.textContent ?? ''))
    if (artifacts instanceof HTMLElement) artifacts.scrollIntoView({ block: 'start' })
    return true
  })()`)
  await sleep(1200)
  await parkPointer()
  await capture('material-actions-artifacts')
})

scene('actions-artifact-download', async () => {
  await openFirstRun()
  await evaluate(`(() => {
    const digest = [...document.querySelectorAll('*')]
      .find(e => e.children.length === 0 && /sha256/i.test(e.textContent ?? ''))
    if (digest instanceof HTMLElement) digest.scrollIntoView({ block: 'center' })
    return true
  })()`)
  await sleep(1000)
  await parkPointer()
  await capture('material-actions-artifact-download')
})

scene('actions-artifact-page-two', async () => {
  await openFirstRun()
  const pageOneArtifactCount = ready.artifactCount - 1
  const pageOneArtifactStatus = `Showing ${pageOneArtifactCount} loaded of ${ready.artifactCount} artifacts.`
  await waitFor(
    `(() => {
      const artifacts = document.querySelector('.actions-run-details .actions-artifacts')
      const pagination = artifacts?.querySelector('.actions-artifact-pagination')
      const status = pagination?.querySelector('[role="status"]')
      const button = [...(pagination?.querySelectorAll('button') ?? [])]
        .find(candidate => candidate.textContent?.trim() === 'Load more artifacts')
      return status?.textContent?.trim() === ${JSON.stringify(
        pageOneArtifactStatus
      )} &&
        artifacts?.querySelectorAll('#actions-artifact-grid .actions-artifact-card').length ===
          ${pageOneArtifactCount} &&
        artifacts?.querySelector('#actions-artifact-${
          ready.artifactSentinelId
        }') === null &&
        button instanceof HTMLButtonElement &&
        !button.disabled &&
        button.getAttribute('aria-disabled') !== 'true'
    })()`,
    'exact page-one artifact inventory and enabled pagination action',
    30000
  )
  for (let round = 0; round < 3; round++) {
    const more = await clickText('Load more artifacts', {
      within: '.actions-run-details .actions-artifacts',
      optional: true,
    })
    if (!more) {
      break
    }
    await sleep(2200)
  }
  await waitFor(
    `(() => {
      const artifacts = document.querySelector('.actions-run-details .actions-artifacts')
      const pagination = artifacts?.querySelector('.actions-artifact-pagination')
      const heading = artifacts?.querySelector('#actions-artifact-${ready.artifactSentinelId}')
      return pagination?.textContent?.trim() === 'Showing ${ready.artifactCount} loaded of ${ready.artifactCount} artifacts.' &&
        heading?.textContent?.trim() ===
          'page-two-artifact-sentinel-with-a-deliberately-long-name-that-must-wrap-without-clipping-overlap-or-sideways-scrolling' &&
        artifacts?.querySelectorAll('#actions-artifact-grid .actions-artifact-card').length === ${ready.artifactCount}
    })()`,
    'complete exact artifact page-two inventory',
    30000
  )
  const positioned = await evaluate(`(() => {
    const details = document.querySelector('.actions-run-details')
    const content = document.querySelector('.actions-content')
    const heading = details?.querySelector('#actions-artifact-${ready.artifactSentinelId}')
    if (!(details instanceof HTMLElement) || !(content instanceof HTMLElement) ||
        !(heading instanceof HTMLElement)) return false
    content.scrollTop = 0
    const detailsBounds = details.getBoundingClientRect()
    const headingBounds = heading.getBoundingClientRect()
    details.scrollTop += headingBounds.top - detailsBounds.top -
      Math.max(0, (details.clientHeight - headingBounds.height) / 2)
    return true
  })()`)
  if (!positioned) {
    fail('The exact artifact page-two sentinel could not be positioned.')
  }
  await evaluate(
    `new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve(true))))`
  )
  await sleep(520)
  await waitFor(
    `(() => {
      const details = document.querySelector('.actions-run-details')
      const content = document.querySelector('.actions-content')
      const artifacts = details?.querySelector('.actions-artifacts')
      const grid = artifacts?.querySelector('#actions-artifact-grid')
      const heading = grid?.querySelector('#actions-artifact-${ready.artifactSentinelId}')
      const card = heading?.closest('.actions-artifact-card')
      if (!(details instanceof HTMLElement) || !(content instanceof HTMLElement) ||
          !(artifacts instanceof HTMLElement) || !(grid instanceof HTMLElement) ||
          !(heading instanceof HTMLElement) || !(card instanceof HTMLElement)) return false
      const detailsBounds = details.getBoundingClientRect()
      const headingBounds = heading.getBoundingClientRect()
      const cardBounds = card.getBoundingClientRect()
      const visibleReviewErrors = [...details.querySelectorAll(
        '.actions-run-reviews .actions-inline-error'
      )].filter(error => {
        const style = getComputedStyle(error)
        const bounds = error.getBoundingClientRect()
        return style.display !== 'none' && style.visibility !== 'hidden' &&
          Number(style.opacity || 1) !== 0 && bounds.width > 0 && bounds.height > 0
      })
      return content.scrollTop === 0 &&
        heading.textContent?.trim() ===
          'page-two-artifact-sentinel-with-a-deliberately-long-name-that-must-wrap-without-clipping-overlap-or-sideways-scrolling' &&
        headingBounds.width > 0 && headingBounds.height > 0 &&
        headingBounds.left >= detailsBounds.left && headingBounds.top >= detailsBounds.top &&
        headingBounds.right <= detailsBounds.right && headingBounds.bottom <= detailsBounds.bottom &&
        cardBounds.width > 0 && cardBounds.height > 0 &&
        cardBounds.left >= detailsBounds.left && cardBounds.right <= detailsBounds.right &&
        cardBounds.bottom > detailsBounds.top && cardBounds.top < detailsBounds.bottom &&
        details.scrollWidth <= details.clientWidth + 1 &&
        grid.scrollWidth <= grid.clientWidth + 1 &&
        artifacts.querySelector('.actions-inline-error[role="alert"]') === null &&
        visibleReviewErrors.length === 0
    })()`,
    'visible exact artifact page-two sentinel',
    30000
  )
  await parkPointer()
  const pageTwo = await capture('material-actions-artifact-page-two')
  await evaluate(`(() => {
    const details = document.querySelector('.actions-run-details')
    const heading = details?.querySelector('#actions-artifacts-heading')
    if (!(details instanceof HTMLElement) || !(heading instanceof HTMLElement)) return false
    const detailsBounds = details.getBoundingClientRect()
    const headingBounds = heading.getBoundingClientRect()
    details.scrollTop += headingBounds.top - detailsBounds.top - 12
    return true
  })()`)
  await sleep(800)
  await parkPointer()
  const inventory = await capture('material-actions-artifacts-headless')
  if (sha256File(pageTwo) === sha256File(inventory)) {
    fail('Artifact page-two and inventory captures are byte-identical.')
  }
})

scene('actions-sentinel', async () => {
  requireInspectorFixture()
  await captureSection('Actions', null, 2500)
  const detailsClosed = await clickText('Close', {
    within: '.actions-run-details',
    optional: true,
  })
  if (detailsClosed) {
    await waitFor(
      `document.querySelector('.actions-run-details') === null`,
      'closed Actions run details before sentinel evidence'
    )
  }
  for (let round = 0; round < 4; round++) {
    const more = await clickText('Load more runs', { optional: true })
    if (!more) {
      break
    }
    await sleep(2500)
  }
  await waitFor(
    `document.querySelector('.actions-run-pagination')?.textContent?.includes('${
      ready?.workflowRunCount
    } loaded of ${
      ready?.workflowRunCount
    } workflow runs') === true && [...document.querySelectorAll('button.actions-run-select')].some(button => button.textContent?.includes(${JSON.stringify(
      InspectorRunTitle
    )}))`,
    'Actions run page-two sentinel',
    30000
  )
  const positioned = await evaluate(`(() => {
    const title = ${JSON.stringify(InspectorRunTitle)}
    const content = document.querySelector('.actions-content')
    const list = document.querySelector('.actions-run-list')
    const run = [...document.querySelectorAll('button.actions-run-select')]
      .find(button => button.textContent?.includes(title))
    if (!(content instanceof HTMLElement) || !(list instanceof HTMLElement) ||
        !(run instanceof HTMLButtonElement)) return false
    content.scrollTop = 0
    const listBounds = list.getBoundingClientRect()
    const runBounds = run.closest('.actions-run-card')?.getBoundingClientRect()
    if (runBounds === undefined) return false
    list.scrollTop += runBounds.top - listBounds.top -
      Math.max(0, (list.clientHeight - runBounds.height) / 2)
    return true
  })()`)
  if (!positioned) {
    fail('The exact Actions inspector sentinel could not be positioned.')
  }
  await evaluate(
    `new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve(true))))`
  )
  await sleep(520)
  await waitFor(
    `(() => {
      const content = document.querySelector('.actions-content')
      const list = document.querySelector('.actions-run-list')
      const run = [...document.querySelectorAll('button.actions-run-select')]
        .find(button => button.querySelector('.actions-run-summary strong')?.textContent?.trim() ===
          ${JSON.stringify(InspectorRunTitle)})
      const card = run?.closest('.actions-run-card')
      const pagination = document.querySelector('.actions-run-pagination')
      if (!(content instanceof HTMLElement) || !(list instanceof HTMLElement) ||
          !(run instanceof HTMLButtonElement) || !(card instanceof HTMLElement) ||
          !(pagination instanceof HTMLElement)) return false
      const contentBounds = content.getBoundingClientRect()
      const listBounds = list.getBoundingClientRect()
      const cardBounds = card.getBoundingClientRect()
      const paginationBounds = pagination.getBoundingClientRect()
      const inside = (inner, outer) =>
        inner.width > 0 && inner.height > 0 &&
        inner.left >= outer.left - 0.5 && inner.top >= outer.top - 0.5 &&
        inner.right <= outer.right + 0.5 && inner.bottom <= outer.bottom + 0.5
      return content.scrollTop === 0 && list.scrollTop > 0 &&
        document.querySelector('.actions-run-details') === null &&
        run.getAttribute('aria-pressed') === 'false' &&
        card.querySelector('.actions-run-number')?.textContent?.trim() === '#125' &&
        pagination.textContent?.includes('${ready.workflowRunCount} loaded of ${
      ready.workflowRunCount
    } workflow runs') === true &&
        document.querySelector('.actions-loading, .actions-inline-error[role="alert"]') === null &&
        inside(cardBounds, listBounds) && inside(listBounds, contentBounds) &&
        inside(paginationBounds, contentBounds) &&
        contentBounds.left >= 0 && contentBounds.top >= 0 &&
        contentBounds.right <= window.innerWidth && contentBounds.bottom <= window.innerHeight
    })()`,
    'visible exact Actions inspector sentinel',
    30000
  )
  await parkPointer()
  await capture('material-actions-sentinel-headless')
})

scene('actions-job-log', async () => {
  await openInspectorRun()
  await loadInspectorPageTwo()
  const openedLog = await evaluate(`(() => {
    const title = ${JSON.stringify(InspectorSentinelJobTitle)}
    const card = [...document.querySelectorAll('.actions-job-card')]
      .find(node => node.textContent?.includes(title))
    const button = card === undefined
      ? null
      : [...card.querySelectorAll('button')]
          .find(node => node.textContent.trim() === 'View logs')
    if (!(button instanceof HTMLElement)) return false
    button.click()
    return true
  })()`)
  if (!openedLog) {
    fail('The exact Actions page-two sentinel log action is unavailable.')
  }
  await waitFor(
    `document.querySelector('.actions-log-viewer')?.textContent?.includes('Exact workflow job ${ready?.inspectorCurrentJobSentinelId}') === true`,
    'exact Actions sentinel log',
    30000
  )
  await parkPointer()
  await capture('material-actions-job-log')
  await clickText('Close', { within: '.actions-log-viewer' })
  await waitFor(
    `document.querySelector('.actions-log-viewer') === null`,
    'closed Actions log viewer'
  )
})

scene('actions-cancel', async () => {
  await captureSection('Actions', null, 2500)
  await waitFor(
    `document.querySelector('[aria-label="Cancel workflow run 74"]') !== null`,
    'deterministic cancellable Actions run'
  )
  await clickSelector('[aria-label="Cancel workflow run 74"]')
  await waitFor(
    `document.querySelector('.actions-confirmation-dialog[role="alertdialog"]')?.textContent?.includes('Cancel workflow run?') === true && document.querySelector('.actions-confirmation-dialog')?.textContent?.includes('#74') === true`,
    'Actions cancellation confirmation'
  )
  await parkPointer()
  await capture('material-actions-cancel')
  await clickText('Keep current state', {
    within: '.actions-confirmation-dialog',
  })
  await waitFor(
    `document.querySelector('.actions-confirmation-dialog') === null`,
    'closed Actions cancellation confirmation'
  )
})

scene('actions-pending-deployments', async () => {
  await openInspectorRun()
  await waitFor(
    `document.querySelectorAll('.actions-pending-environment').length === 2 && document.querySelector('.actions-run-reviews')?.textContent?.includes('Locked deployment environment') === true`,
    'two pending deployment environments',
    30000
  )
  await evaluate(`(() => {
    const reviews = document.querySelector('.actions-run-reviews')
    if (!(reviews instanceof HTMLElement)) return false
    reviews.scrollIntoView({ block: 'start' })
    return true
  })()`)
  await sleep(800)
  await parkPointer()
  await capture('material-actions-pending-deployments')
})

// "Raw" scenes assume the Actions run details pane is already open and
// capture its states without re-navigating (section re-entry can toggle
// the selection away).
scene('raw-artifacts', async () => {
  await evaluate(`(() => {
    const h = [...document.querySelectorAll('h2, h3')].find(x => /artifact/i.test(x.textContent ?? ''))
    if (h instanceof HTMLElement) h.scrollIntoView({ block: 'start' })
    return true
  })()`)
  await sleep(900)
  await parkPointer()
  await capture('material-actions-artifacts')
})

scene('raw-digest', async () => {
  await evaluate(`(() => {
    const digest = [...document.querySelectorAll('*')]
      .find(e => e.children.length === 0 && /sha-?256/i.test(e.textContent ?? ''))
    if (digest instanceof HTMLElement) digest.scrollIntoView({ block: 'center' })
    return true
  })()`)
  await sleep(800)
  await parkPointer()
  await capture('material-actions-artifact-download')
})

scene('raw-artifact-pages', async () => {
  for (let round = 0; round < 3; round++) {
    const more = await clickText('Load more artifacts', { optional: true })
    if (!more) {
      break
    }
    await sleep(2200)
  }
  await evaluate(`(() => {
    const sentinel = [...document.querySelectorAll('*')]
      .find(e => e.children.length === 0 && /sentinel/i.test(e.textContent ?? ''))
    if (sentinel instanceof HTMLElement) sentinel.scrollIntoView({ block: 'center' })
    return true
  })()`)
  await sleep(800)
  await parkPointer()
  await capture('material-actions-artifact-page-two')
  // The headless-evidence variant shows the same bounded inventory from the
  // top of the artifacts list rather than the sentinel row.
  await evaluate(`(() => {
    const h = [...document.querySelectorAll('h2, h3')].find(x => /artifact/i.test(x.textContent ?? ''))
    if (h instanceof HTMLElement) h.scrollIntoView({ block: 'start' })
    return true
  })()`)
  await sleep(700)
  await capture('material-actions-artifacts-headless')
})

scene('raw-job-log', async () => {
  await loadInspectorPageTwo()
  const opened = await evaluate(`(() => {
    const card = [...document.querySelectorAll('.actions-job-card')]
      .find(node => node.textContent?.includes(${JSON.stringify(
        InspectorSentinelJobTitle
      )}))
    const button = card === undefined
      ? null
      : [...card.querySelectorAll('button')]
          .find(node => node.textContent.trim() === 'View logs')
    if (!(button instanceof HTMLElement)) return false
    button.click()
    return true
  })()`)
  if (!opened) fail('Unable to open the exact raw sentinel log.')
  await waitFor(
    `document.querySelector('.actions-log-viewer')?.textContent?.includes('Exact workflow job ${ready?.inspectorCurrentJobSentinelId}') === true`,
    'raw exact Actions sentinel log'
  )
  await parkPointer()
  await capture('material-actions-job-log')
  await clickText('Close', { within: '.actions-log-viewer' })
  await waitFor(
    `document.querySelector('.actions-log-viewer') === null`,
    'closed raw Actions log'
  )
})

scene('raw-deployments', async () => {
  await waitFor(
    `document.querySelectorAll('.actions-pending-environment').length === 2 && document.querySelector('.actions-run-reviews')?.textContent?.includes('Locked deployment environment') === true`,
    'raw pending deployment environments'
  )
  await evaluate(`(() => {
    const reviews = document.querySelector('.actions-run-reviews')
    if (!(reviews instanceof HTMLElement)) return false
    reviews.scrollIntoView({ block: 'start' })
    return true
  })()`)
  await sleep(800)
  await parkPointer()
  await capture('material-actions-pending-deployments')
})

scene('merge-all', async () => {
  if (fixturePath === null) {
    fail('Merge All requires a disposable fixture path.')
  }
  assertOwnedDisposableFixture()
  await ensureRepository()
  const originHead = execFileSync(
    'git',
    ['-C', fixturePath, 'symbolic-ref', 'refs/remotes/origin/HEAD'],
    { encoding: 'utf8', windowsHide: true }
  ).trim()
  if (originHead !== `refs/remotes/origin/${ready.defaultBranch}`) {
    fail(`Fixture remote HEAD disagrees with its default branch: ${originHead}`)
  }
  const startingBranch = execFileSync(
    'git',
    ['-C', fixturePath, 'branch', '--show-current'],
    { encoding: 'utf8', windowsHide: true }
  ).trim()
  if (startingBranch !== ready.featureBranch) {
    fail(
      `Merge All fixture must start on ${ready.featureBranch}: ${startingBranch}`
    )
  }
  for (const [branch, startPoint] of [
    ['main', 'origin/main'],
    ['gallery/merge-all-evidence', 'origin/main'],
  ]) {
    try {
      execFileSync(
        'git',
        [
          '-C',
          fixturePath,
          'show-ref',
          '--verify',
          '--quiet',
          `refs/heads/${branch}`,
        ],
        { windowsHide: true, stdio: 'ignore' }
      )
    } catch {
      execFileSync('git', ['-C', fixturePath, 'branch', branch, startPoint], {
        windowsHide: true,
        stdio: 'ignore',
      })
    }
  }
  await evaluate(`require('electron').ipcRenderer.emit('focus'), true`)
  await sleep(1800)
  await menuEvent('show-branches')
  await waitFor(
    `document.querySelector('.merge-all-button') !== null`,
    'Merge All branches action'
  )
  await clickText('Merge all into default')
  await waitFor(
    `(() => {
      const summary = document.querySelector('#merge-all .merge-all-summary')
      const rows = [...document.querySelectorAll('#merge-all .merge-all-results tbody tr')]
      if (summary?.textContent?.trim() !== 'Complete. No push was needed.' || rows.length !== 1) {
        return false
      }
      const row = rows[0]
      return row.querySelector('td[data-label="Branch"]')?.textContent?.trim() ===
          'gallery/merge-all-evidence' &&
        row.querySelector('.merge-result')?.textContent?.trim() === 'up-to-date' &&
        row.querySelector('td[data-label="Details"]')?.textContent?.trim() ===
          'Already up to date; cleaned up and deleted.' &&
        !rows.some(candidate =>
          candidate.querySelector('td[data-label="Branch"]')?.textContent?.trim() === 'main'
        )
    })()`,
    'single safe Merge All result',
    45000
  )
  const survivingBranch = execFileSync(
    'git',
    ['-C', fixturePath, 'branch', '--show-current'],
    { encoding: 'utf8', windowsHide: true }
  ).trim()
  let mainExists = true
  let evidenceExists = true
  try {
    execFileSync(
      'git',
      ['-C', fixturePath, 'show-ref', '--verify', '--quiet', 'refs/heads/main'],
      { windowsHide: true, stdio: 'ignore' }
    )
  } catch {
    mainExists = false
  }
  try {
    execFileSync(
      'git',
      [
        '-C',
        fixturePath,
        'show-ref',
        '--verify',
        '--quiet',
        'refs/heads/gallery/merge-all-evidence',
      ],
      { windowsHide: true, stdio: 'ignore' }
    )
  } catch {
    evidenceExists = false
  }
  if (
    survivingBranch !== ready.defaultBranch ||
    !mainExists ||
    evidenceExists
  ) {
    fail(
      `Merge All branch cleanup violated the default-branch contract: ${JSON.stringify(
        { survivingBranch, mainExists, evidenceExists }
      )}`
    )
  }
  await parkPointer()
  await capture('material-branch-merge-all')
  await closeAllDialogs()
  await pressEscape(1)
})

scene('advanced-workflows', async () => {
  prepareAdvancedWorkflowTagFixture()
  await ensureRepository()
  await menuEvent('show-repository-tools')
  await waitFor(
    `document.querySelector('.repository-tools-sidebar') !== null`,
    'Repository Tools sidebar'
  )
  await maskRepositoryToolsIntroduction()
  await setInput('.repository-tools-search-input', 'Tag lifecycle')
  await waitFor(
    `document.querySelector('[data-hub-tool="tag-lifecycle"]') !== null`,
    'Tag lifecycle tool'
  )
  await clickSelector('[data-hub-tool="tag-lifecycle"]')
  await waitFor(
    `(() => {
      const manager = document.querySelector('.tag-lifecycle-manager')
      if (!(manager instanceof HTMLElement)) return false
      const localHeading = [...manager.querySelectorAll('.tag-lifecycle-inventory > h3')]
        .find(node => node.textContent?.trim() === 'Local tags (3)')
      const localNames = [...manager.querySelectorAll('.tag-lifecycle-row:not(.remote) strong')]
        .map(node => node.textContent?.trim() ?? '')
        .sort()
      return localHeading !== undefined &&
        JSON.stringify(localNames) === '["preview-local","v1.0.0","v1.1.0"]'
    })()`,
    'exact three-tag local lifecycle inventory',
    30000
  )
  const loadRemoteSelector =
    '.tag-lifecycle-manager > header .tag-lifecycle-actions button:nth-of-type(2)'
  await waitFor(
    `document.querySelector(${JSON.stringify(
      loadRemoteSelector
    )})?.textContent?.trim() === 'Load remote' && !document.querySelector(${JSON.stringify(
      loadRemoteSelector
    )}).disabled && document.querySelector(${JSON.stringify(
      loadRemoteSelector
    )}).getAttribute('aria-disabled') !== 'true'`,
    'enabled remote tag inventory action',
    30000
  )
  await clickEnabledSelector(loadRemoteSelector)
  await waitFor(
    `(() => {
      const manager = document.querySelector('.tag-lifecycle-manager')
      if (!(manager instanceof HTMLElement)) return false
      const headings = [...manager.querySelectorAll('.tag-lifecycle-inventory > h3')]
        .map(node => node.textContent?.trim() ?? '')
      const rows = [...manager.querySelectorAll('.tag-lifecycle-row')]
      const textByName = new Map(rows.map(row => [
        row.querySelector('strong')?.textContent?.trim() ?? '',
        (row.textContent ?? '').replace(/\\s+/g, ' ').trim(),
      ]))
      const localNames = rows
        .filter(row => !row.classList.contains('remote'))
        .map(row => row.querySelector('strong')?.textContent?.trim() ?? '')
        .sort()
      const remoteNames = rows
        .filter(row => row.classList.contains('remote'))
        .map(row => row.querySelector('strong')?.textContent?.trim() ?? '')
        .sort()
      return headings.includes('Local tags (3)') &&
        headings.includes('Remote-only tags (1) on origin') &&
        JSON.stringify(localNames) === '["preview-local","v1.0.0","v1.1.0"]' &&
        JSON.stringify(remoteNames) === '["archive-remote"]' &&
        textByName.get('preview-local')?.includes('Local only') === true &&
        textByName.get('v1.0.0')?.includes('Pushed') === true &&
        textByName.get('v1.1.0')?.includes('Pushed') === true &&
        textByName.get('archive-remote')?.includes('remote only') === true
    })()`,
    'exact local-only, pushed, and remote-only tag inventory',
    30000
  )
  await evaluate(`(() => {
    const heading = [...document.querySelectorAll('.tag-lifecycle-manager h3')]
      .find(node => node.textContent?.trim() === 'Remote-only tags (1) on origin')
    if (heading instanceof HTMLElement) heading.scrollIntoView({ block: 'center' })
    return heading instanceof HTMLElement
  })()`)
  await sleep(900)
  const receipt = await evaluate(`(() => {
    const manager = document.querySelector('.tag-lifecycle-manager')
    const sidebar = document.querySelector('.repository-tools-sidebar')
    const resultsColumn = document.querySelector('.repository-tools-results-column')
    const inventory = document.querySelector('.tag-lifecycle-inventory')
    if (
      !(manager instanceof HTMLElement) ||
      !(sidebar instanceof HTMLElement) ||
      !(resultsColumn instanceof HTMLElement) ||
      !(inventory instanceof HTMLElement)
    ) {
      return null
    }
    const visible = element => {
      if (!(element instanceof HTMLElement)) return false
      const style = getComputedStyle(element)
      const bounds = element.getBoundingClientRect()
      return style.display !== 'none' && style.visibility !== 'hidden' &&
        Number(style.opacity || 1) !== 0 && bounds.width > 0 && bounds.height > 0
    }
    const rectangle = element => {
      const bounds = element.getBoundingClientRect()
      return {
        left: bounds.left,
        right: bounds.right,
        top: bounds.top,
        bottom: bounds.bottom,
        width: bounds.width,
        height: bounds.height,
        clientWidth: element.clientWidth,
        scrollWidth: element.scrollWidth,
      }
    }
    const within = (child, parent) =>
      child.left >= parent.left - 0.5 &&
      child.right <= parent.right + 0.5 &&
      child.top >= parent.top - 0.5 &&
      child.bottom <= parent.bottom + 0.5
    const intersects = (first, second) =>
      first.left < second.right - 0.5 &&
      first.right > second.left + 0.5 &&
      first.top < second.bottom - 0.5 &&
      first.bottom > second.top + 0.5
    const viewport = {
      left: 0,
      right: window.innerWidth,
      top: 0,
      bottom: window.innerHeight,
    }
    const managerRect = rectangle(manager)
    const resultsColumnRect = rectangle(resultsColumn)
    const inventoryRect = rectangle(inventory)
    const rows = [...manager.querySelectorAll('.tag-lifecycle-row')].map(row => {
      const rowRect = rectangle(row)
      const buttons = [...row.querySelectorAll('button')].map(button => ({
        label: button.textContent?.trim() ?? '',
        ...rectangle(button),
      }))
      const text = (row.textContent ?? '').replace(/\\s+/g, ' ').trim()
      const remote = row.classList.contains('remote')
      return {
        name: row.querySelector('strong')?.textContent?.trim() ?? '',
        remote,
        state: remote
          ? text.includes('remote only')
            ? 'remote-only'
            : 'unknown'
          : text.includes('Local only')
          ? 'local-only'
          : text.includes('Pushed')
          ? 'pushed'
          : 'unknown',
        text,
        visible: visible(row),
        bounds: rowRect,
        withinViewport: within(rowRect, viewport),
        withinResultsColumn: within(rowRect, resultsColumnRect),
        withinInventoryHorizontally:
          rowRect.left >= inventoryRect.left - 0.5 &&
          rowRect.right <= inventoryRect.right + 0.5,
        horizontalOverflow: row.scrollWidth > row.clientWidth + 1,
        buttons,
        buttonsWithinRow: buttons.every(button => within(button, rowRect)),
        buttonsOverlap: buttons.some((first, index) =>
          buttons.slice(index + 1).some(second => intersects(first, second))
        ),
      }
    })
    const headings = [...manager.querySelectorAll('.tag-lifecycle-inventory > h3')]
      .map(node => node.textContent?.trim() ?? '')
    const visibleErrors = [...manager.querySelectorAll('[role="alert"], .tag-lifecycle-error')]
      .filter(visible)
      .map(node => node.textContent?.trim() ?? '')
    const visibleText = document.body.innerText
    return {
      language: document.body.getAttribute('data-dm-language-mode'),
      headings,
      localNames: rows.filter(row => !row.remote).map(row => row.name).sort(),
      remoteNames: rows.filter(row => row.remote).map(row => row.name).sort(),
      rows,
      visibleErrors,
      manager: managerRect,
      resultsColumn: resultsColumnRect,
      inventory: inventoryRect,
      horizontalOverflow:
        document.documentElement.scrollWidth > document.documentElement.clientWidth + 1 ||
        document.body.scrollWidth > document.body.clientWidth + 1 ||
        manager.scrollWidth > manager.clientWidth + 1 ||
        sidebar.scrollWidth > sidebar.clientWidth + 1 ||
        resultsColumn.scrollWidth > resultsColumn.clientWidth + 1 ||
        inventory.scrollWidth > inventory.clientWidth + 1,
      leakedPath: /C:\\\\Users\\\\[^\\s]+|AppData\\\\Local\\\\Temp/i.test(visibleText),
    }
  })()`)
  const expectedStates = [
    'archive-remote:remote-only',
    'preview-local:local-only',
    'v1.0.0:pushed',
    'v1.1.0:pushed',
  ]
  const actualStates =
    receipt?.rows.map(row => `${row.name}:${row.state}`).sort() ?? []
  const rowsHaveValidGeometry =
    receipt?.rows.length === 4 &&
    receipt.rows.every(
      row =>
        row.visible &&
        row.withinViewport &&
        row.withinResultsColumn &&
        row.withinInventoryHorizontally &&
        !row.horizontalOverflow &&
        row.buttonsWithinRow &&
        !row.buttonsOverlap
    )
  if (
    receipt === null ||
    receipt.language !== 'english' ||
    JSON.stringify(receipt.headings) !==
      JSON.stringify(['Local tags (3)', 'Remote-only tags (1) on origin']) ||
    JSON.stringify(receipt.localNames) !==
      JSON.stringify(['preview-local', 'v1.0.0', 'v1.1.0']) ||
    JSON.stringify(receipt.remoteNames) !==
      JSON.stringify(['archive-remote']) ||
    JSON.stringify(actualStates) !== JSON.stringify(expectedStates) ||
    receipt.visibleErrors.length !== 0 ||
    !rowsHaveValidGeometry ||
    receipt.horizontalOverflow ||
    receipt.leakedPath
  ) {
    fail(
      `Advanced workflows failed semantic/geometry/privacy checks: ${JSON.stringify(
        receipt
      )}`
    )
  }
  await parkPointer()
  await capture('advanced-workflows')
})

scene('cheap-lfs-preparing', async () => {
  if (fixturePath === null || ready === null) {
    fail('Cheap-LFS preparation requires a disposable provider-backed fixture.')
  }
  assertOwnedDisposableFixture()
  const cheapLfsBranch = 'gallery/cheap-lfs-evidence'
  const cheapLfsBaseRef = `refs/heads/${ready.featureBranch}^{commit}`
  const cheapLfsBaseHead = execFileSync(
    'git',
    ['-C', fixturePath, 'rev-parse', '--verify', cheapLfsBaseRef],
    { encoding: 'utf8', windowsHide: true }
  ).trim()
  execFileSync(
    'git',
    [
      '-C',
      fixturePath,
      'checkout',
      '--quiet',
      '-B',
      cheapLfsBranch,
      cheapLfsBaseRef,
    ],
    { windowsHide: true, stdio: 'ignore' }
  )
  const checkedOutBranch = execFileSync(
    'git',
    ['-C', fixturePath, 'branch', '--show-current'],
    { encoding: 'utf8', windowsHide: true }
  ).trim()
  const checkedOutHead = execFileSync(
    'git',
    ['-C', fixturePath, 'rev-parse', 'HEAD'],
    { encoding: 'utf8', windowsHide: true }
  ).trim()
  const baseStatus = execFileSync(
    'git',
    ['-C', fixturePath, 'status', '--porcelain=v1', '--untracked-files=all'],
    { encoding: 'utf8', windowsHide: true }
  ).trim()
  if (
    checkedOutBranch !== cheapLfsBranch ||
    checkedOutHead !== cheapLfsBaseHead ||
    baseStatus !== ''
  ) {
    fail(
      `Cheap-LFS evidence branch did not start from the clean prepared fixture: ${JSON.stringify(
        {
          checkedOutBranch,
          checkedOutHead,
          cheapLfsBaseHead,
          baseStatus,
        }
      )}`
    )
  }
  const largeFileName = 'windows-enterprise-evaluation.iso'
  const largeFilePath = path.join(fixturePath, largeFileName)
  const descriptor = fs.openSync(largeFilePath, 'wx')
  try {
    fs.writeSync(
      descriptor,
      Buffer.from(
        'Desktop Material synthetic large-file verification fixture\n'
      )
    )
    fs.ftruncateSync(descriptor, 100 * 1024 * 1024 + 4096)
  } finally {
    fs.closeSync(descriptor)
  }
  const preparedStatus = execFileSync(
    'git',
    ['-C', fixturePath, 'status', '--porcelain=v1', '--untracked-files=all'],
    { encoding: 'utf8', windowsHide: true }
  )
    .trim()
    .split(/\r?\n/)
  if (
    preparedStatus.length !== 1 ||
    preparedStatus[0] !== `?? ${largeFileName}`
  ) {
    fail(
      `Cheap-LFS fixture did not contain exactly the owned large file: ${JSON.stringify(
        preparedStatus
      )}`
    )
  }

  await ensureRepository()
  await menuEvent('show-changes')
  await evaluate(`require('electron').ipcRenderer.emit('focus'), true`)
  await waitFor(
    `document.querySelector('.commit-button')?.textContent?.includes('Commit 1 file to ${cheapLfsBranch}') === true`,
    'isolated Cheap-LFS evidence branch',
    30000
  )
  await waitFor(
    `document.body.textContent?.includes(${JSON.stringify(
      largeFileName
    )}) === true`,
    'synthetic oversized file in Changes',
    30000
  )
  await setInput('.summary-field input', 'Route large ISO through cheap LFS')
  await waitFor(
    `document.querySelector('.commit-button') instanceof HTMLButtonElement && !document.querySelector('.commit-button').disabled && document.querySelector('.commit-button').getAttribute('aria-disabled') !== 'true'`,
    'enabled cheap-LFS commit action'
  )
  await clickEnabledSelector('.commit-button')
  await waitFor(
    `document.body.textContent?.includes('Preparing 1 large file for cheap LFS') === true`,
    'cheap-LFS preparation phase',
    30000
  )
  await parkPointer()
  await capture('material-cheap-lfs-preparing')
})

async function main() {
  if (args.has('list')) {
    for (const name of scenes.keys()) {
      process.stdout.write(`${name}\n`)
    }
    return
  }

  const targets = await getJSON('/json/list')
  const page = targets.find(
    target => target.type === 'page' && target.url.includes('out/index.html')
  )
  if (page === undefined) {
    fail('Desktop Material page target not found.')
  }

  client = new CDPClient(page.webSocketDebuggerUrl)
  await client.open()
  try {
    await client.send('Runtime.enable')
    await client.send('Page.enable')
    await restoreCaptureViewport()

    if (args.has('probe')) {
      const value = await evaluate(args.get('probe'))
      process.stdout.write(`PROBE ${JSON.stringify(value, null, 1)}\n`)
    }

    const canonical = args.get('canonical') === 'true'
    if (canonical && args.has('scenes')) {
      fail('Use either --canonical true or --scenes, not both.')
    }
    const names = canonical
      ? [...CanonicalGalleryScenes]
      : (args.get('scenes') ?? '')
          .split(',')
          .map(value => value.trim())
          .filter(value => value.length > 0)

    if (names.length > 0 && fixturePath !== null) {
      assertOwnedDisposableFixture()
    }

    for (const name of names) {
      const run = scenes.get(name)
      if (run === undefined) {
        fail(`Unknown scene: ${name}`)
      }
      process.stdout.write(`SCENE ${name}\n`)
      await resetSceneState(name)
      await run()
    }

    if (canonical) {
      const expected = [...CanonicalGalleryOutputs].sort()
      const actual = [...capturedNames].sort()
      if (
        capturedNames.length !== new Set(capturedNames).size ||
        JSON.stringify(actual) !== JSON.stringify(expected)
      ) {
        fail(
          `Canonical gallery did not produce the exact 68-output set: ${JSON.stringify(
            { expected, actual }
          )}`
        )
      }
      process.stdout.write('CANONICAL 68/68 exact output set\n')
    }
  } finally {
    // This style is capture-only state. Leaving it installed breaks normal
    // hover help (and later accessibility verification) in the renderer.
    await evaluate(`(() => {
      document.getElementById('gallery-tooltip-suppressor')?.remove()
      return true
    })()`).catch(() => undefined)
    client.close()
  }
}

main().catch(error => {
  process.stderr.write(`CAPTURE_FAIL ${error?.stack ?? String(error)}\n`)
  try {
    client?.close()
  } catch {}
  process.exit(1)
})
