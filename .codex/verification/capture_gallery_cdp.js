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

const DefaultWidth = 1440
const DefaultHeight = 960
const CaptureWidth = Number(args.get('width') ?? DefaultWidth)
const CaptureHeight = Number(args.get('height') ?? DefaultHeight)

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
  await assertCapturePrivacy(name)
  fs.mkdirSync(outDir, { recursive: true })
  const shot = await client.send('Page.captureScreenshot', { format: 'png' })
  const file = path.join(outDir, `${name}.png`)
  fs.writeFileSync(file, Buffer.from(shot.data, 'base64'), { flag: 'wx' })
  const digest = sha256File(file)
  const duplicate = capturedHashes.get(digest)
  if (duplicate !== undefined) {
    fail(`Capture ${name}.png duplicates ${duplicate}.png byte-for-byte.`)
  }
  capturedHashes.set(digest, name)
  capturedNames.push(name)
  const size = fs.statSync(file).size
  process.stdout.write(`CAPTURED ${name}.png ${size}b\n`)
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
    const expected = {
      'has-shown-welcome-flow': '1',
      'theme': 'light',
      'zoom-auto-fit-enabled': '1',
      'stats-opt-out': '1',
      'has-sent-stats-opt-in-ping': '1'
    }
    let changed = false
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
    return changed
  })()`)

  const changed = providerRemoteChanged || profileChanged
  if (changed) {
    await evaluate('window.location.reload(), true')
    await sleep(4500)
    await client.send('Runtime.enable')
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
  await ensureRepository()
  await menuEvent('show-preferences')
  await sleep(1400)
  await capture('material-settings')
  await closeAllDialogs()
})

/** Open Settings on a named tab and capture. */
async function captureSettingsTab(tabLabel, name, beforeCapture = null) {
  await ensureRepository()
  await menuEvent('show-preferences')
  await waitFor(
    `document.querySelector('#preferences') !== null`,
    'settings dialog'
  )
  await sleep(700)
  if (tabLabel !== null) {
    await clickText(tabLabel, { within: '#preferences' })
    await sleep(900)
  }
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
  await sleep(900)
  await parkPointer()
  await capture('material-customization')
  await closeAllDialogs()
})

scene('settings-accounts', async () => {
  await captureSettingsTab('Accounts', 'material-provider-accounts')
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
  await captureSection('Issues', 'material-github-issues', 3500)
})

scene('provider-triage', async () => {
  await captureSection('Triage', 'material-provider-triage', 3000)
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
    const run = [...document.querySelectorAll('button.actions-run-select')]
      .find(button => button.textContent?.includes(title))
    if (!(run instanceof HTMLElement)) return false
    run.scrollIntoView({ block: 'center' })
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
  await contextMenuSelector('[data-customization-surface="app-identity"]')
  await waitForPrivacySafeAnchoredEditor('app-identity owner appearance editor')
  await waitFor(
    `document.querySelector('.app-identity-section') !== null`,
    'app identity controls'
  )
  await sleep(900)
  await parkPointer()
  await capture('material-app-identity-workspace')
  await closeAllDialogs()
})

scene('multi-window-menu', async () => {
  await ensureRepository()
  ;(await clickAria('Open a repository in a new tab', { optional: true })) ||
    (await clickAria('Open in a new window', { optional: true })) ||
    (await clickAria('Windows', { optional: true }))
  await sleep(1200)
  await parkPointer()
  await capture('material-multi-window-menu')
  await pressEscape(1)
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
  await setInput('input[placeholder*="Search commits"]', 'provider')
  await sleep(1400)
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
  await sleep(900)
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
  await waitFor(
    `[...document.querySelectorAll('#create-github-pull-request button')].some(button => button.textContent.trim() === 'Review pull request' && !button.disabled)`,
    'enabled pull-request review action',
    30000
  )
  await clickText('Review pull request', {
    within: '#create-github-pull-request',
  })
  await waitFor(
    `document.querySelector('.create-github-pull-request-review') !== null && document.querySelector('.create-github-pull-request-context')?.textContent?.includes('feature/material-verification → main') === true`,
    'reviewed feature-to-main pull-request route'
  )
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
  for (let attempt = 0; attempt < 2; attempt++) {
    const detailsOpen = await evaluate(`(() =>
      [...document.querySelectorAll('.actions-view h2, .actions-view h3')]
        .some(h => /jobs|attempt/i.test(h.textContent ?? '')) ||
      document.querySelector('[class*=run-details]') !== null
    )()`)
    if (detailsOpen) {
      return
    }
    await evaluate(`(() => {
      const rows = [...document.querySelectorAll('button.actions-run-select')]
      const row = rows[${index}] ?? rows[0]
      if (row instanceof HTMLElement) row.click()
      return true
    })()`)
    await sleep(3000)
  }
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
  await sleep(900)
  await parkPointer()
  const pageTwo = await capture('material-actions-artifact-page-two')
  await evaluate(`(() => {
    const heading = [...document.querySelectorAll('h2, h3, h4')]
      .find(node => /artifact/i.test(node.textContent ?? ''))
    if (!(heading instanceof HTMLElement)) return false
    heading.scrollIntoView({ block: 'start' })
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
  await evaluate(`(() => {
    const column = document.querySelector('.actions-run-column')
    if (column instanceof HTMLElement) column.scrollTop = column.scrollHeight
    const main = document.querySelector('.actions-view')
    if (main instanceof HTMLElement) main.scrollTop = main.scrollHeight
    return true
  })()`)
  await sleep(900)
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
  await ensureRepository()
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
    `document.querySelector('#merge-all .merge-all-summary')?.textContent?.trim().startsWith('Complete.') === true && document.querySelectorAll('#merge-all .merge-all-results tbody tr').length > 0`,
    'completed Merge All evidence',
    45000
  )
  await parkPointer()
  await capture('material-branch-merge-all')
  await closeAllDialogs()
  await pressEscape(1)
})

scene('advanced-workflows', async () => {
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
    `document.querySelector('.tag-lifecycle-manager')?.textContent?.includes('Local tags') === true`,
    'local tag lifecycle inventory',
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
    `document.querySelector('.tag-lifecycle-manager')?.textContent?.includes('Remote-only tags') === true`,
    'remote-only tag inventory',
    30000
  )
  const receipt = await evaluate(`(() => {
    const manager = document.querySelector('.tag-lifecycle-manager')
    const sidebar = document.querySelector('.repository-tools-sidebar')
    if (!(manager instanceof HTMLElement) || !(sidebar instanceof HTMLElement)) {
      return null
    }
    const visibleText = document.body.innerText
    return {
      language: document.body.getAttribute('data-dm-language-mode'),
      horizontalOverflow:
        document.documentElement.scrollWidth > document.documentElement.clientWidth + 1 ||
        document.body.scrollWidth > document.body.clientWidth + 1 ||
        manager.scrollWidth > manager.clientWidth + 1 ||
        sidebar.scrollWidth > sidebar.clientWidth + 1,
      leakedPath: /C:\\\\Users\\\\[^\\s]+|AppData\\\\Local\\\\Temp/i.test(visibleText),
    }
  })()`)
  if (
    receipt === null ||
    receipt.language !== 'english' ||
    receipt.horizontalOverflow ||
    receipt.leakedPath
  ) {
    fail(
      `Advanced workflows failed geometry/privacy checks: ${JSON.stringify(
        receipt
      )}`
    )
  }
  await evaluate(`(() => {
    const heading = [...document.querySelectorAll('.tag-lifecycle-manager h3')]
      .find(node => node.textContent?.startsWith('Remote-only tags'))
    if (heading instanceof HTMLElement) heading.scrollIntoView({ block: 'center' })
    return true
  })()`)
  await sleep(900)
  await parkPointer()
  await capture('advanced-workflows')
})

scene('cheap-lfs-preparing', async () => {
  if (fixturePath === null) {
    fail('Cheap-LFS preparation requires a disposable fixture path.')
  }
  const cheapLfsBranch = 'gallery/cheap-lfs-evidence'
  execFileSync(
    'git',
    ['-C', fixturePath, 'checkout', '--quiet', '-B', cheapLfsBranch],
    { windowsHide: true, stdio: 'ignore' }
  )
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
