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
const { execFileSync } = require('child_process')
const http = require('http')
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
  fs.mkdirSync(outDir, { recursive: true })
  const shot = await client.send('Page.captureScreenshot', { format: 'png' })
  const file = path.join(outDir, `${name}.png`)
  fs.writeFileSync(file, Buffer.from(shot.data, 'base64'), { flag: 'wx' })
  capturedNames.push(name)
  const size = fs.statSync(file).size
  process.stdout.write(`CAPTURED ${name}.png ${size}b\n`)
  if (size < 20000) {
    process.stdout.write(`WARN ${name}.png is suspiciously small\n`)
  }
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

function ensureDirectFixtureProviderRemote() {
  if (ready === null || fixturePath === null) {
    return false
  }

  const endpoint = new URL(ready.endpoint)
  if (!['127.0.0.1', 'localhost', '::1'].includes(endpoint.hostname)) {
    fail(`Fixture provider is not loopback-only: ${endpoint.hostname}`)
  }
  const directURL = `${endpoint.origin}/${ready.owner}/${ready.repository}.git`
  const currentURL = execFileSync(
    'git',
    ['-C', fixturePath, 'remote', 'get-url', 'origin'],
    { encoding: 'utf8' }
  ).trim()
  if (currentURL === directURL) {
    return false
  }
  execFileSync(
    'git',
    ['-C', fixturePath, 'remote', 'set-url', 'origin', directURL],
    { stdio: 'ignore' }
  )
  return true
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
          ['Cancel', 'Close', 'Done', 'Not now'].includes(
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
  await sleep(1500)
  await parkPointer()
  await capture('settings-history-manager')
  await closeAllDialogs()
})

scene('sparse-checkout', async () => {
  await ensureRepository()
  await menuEvent('manage-sparse-checkout')
  await sleep(1500)
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
  await sleep(1800)
  await parkPointer()
  await capture('material-repository-tools')
})

scene('repository-tools-scroll', async () => {
  await ensureRepository()
  await menuEvent('show-repository-tools')
  await sleep(1200)
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
  await setInput(
    'input[aria-label="Commit summary"]',
    'Verify stale lock recovery'
  )

  const lockPath = path.join(fixturePath, '.git', 'index.lock')
  fs.writeFileSync(lockPath, 'stale Desktop Material verification lock\n', {
    flag: 'wx',
  })
  const staleTime = new Date(Date.now() - 120_000)
  fs.utimesSync(lockPath, staleTime, staleTime)

  await clickSelector('.commit-button')
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
  await evaluate(`(() => {
    const panel = document.querySelector('.github-api-functions')
    if (panel instanceof HTMLElement) {
      panel.scrollIntoView({ block: 'start' })
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

scene('actions-run-details', async () => {
  await captureSection('Actions', null, 2500)
  await evaluate(`(() => {
    const row = document.querySelector('.actions-run-row, [class*=actions-run-] button, .actions-run-column .list-item')
    if (row instanceof HTMLElement) { row.click(); return true }
    const anyRun = [...document.querySelectorAll('.actions-view button')].find(b => /Run|workflow/i.test(b.textContent))
    if (anyRun) { anyRun.click(); return true }
    return false
  })()`)
  await sleep(3000)
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
  await sleep(1000)
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
  for (let index = 0; index < 4; index++) {
    await menuEvent('zoom-in')
  }
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
  await sleep(1200)
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
  await sleep(1500)
  await clickText('main', { optional: true })
  await sleep(1200)
  await parkPointer()
  await capture('material-rebase-review')
  await closeAllDialogs()
})

scene('pull-request-compose', async () => {
  await ensureRepository()
  await menuEvent('preview-pull-request')
  await sleep(2500)
  await parkPointer()
  await capture('material-native-pull-request')
  await closeAllDialogs()
})

scene('pull-request-open', async () => {
  await ensureRepository()
  await menuEvent('open-pull-request')
  await sleep(2500)
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
  await sleep(1500)
  const input = await evaluate(`(() => {
    const field = [...document.querySelectorAll('dialog input[type=text], dialog textarea')]
      .find(x => x.closest('dialog')?.open)
    return field !== null && field !== undefined
  })()`)
  if (input) {
    await evaluate(`(() => {
      const field = [...document.querySelectorAll('dialog input[type=text], dialog textarea')]
        .find(x => x.closest('dialog')?.open)
      if (!field) return false
      const proto = field instanceof HTMLTextAreaElement
        ? window.HTMLTextAreaElement.prototype : window.HTMLInputElement.prototype
      Object.getOwnPropertyDescriptor(proto, 'value').set.call(field, 'docs/')
      field.dispatchEvent(new Event('input', { bubbles: true }))
      return true
    })()`)
    await sleep(900)
  }
  await parkPointer()
  await capture('material-sparse-checkout-safe')
  await closeAllDialogs()
})

scene('pull-all', async () => {
  await ensureRepository()
  await menuEvent('choose-repository')
  await sleep(1200)
  await clickText('Pull all', { optional: true })
  await sleep(2500)
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
  await parkPointer()
  await capture('material-clone-account-fallback')
  await closeAllDialogs()
})

scene('regex-builder', async () => {
  await ensureRepository()
  await menuEvent('show-history')
  await sleep(1200)
  await ensureCommitList()
  await clickAria('Search filters', { optional: true })
  await sleep(700)
  ;(await clickText('Regex builder', { optional: true })) ||
    (await clickAria('Regex builder', { optional: true })) ||
    (await clickAria('Open regex builder', { optional: true }))
  await sleep(1500)
  await parkPointer()
  await capture('regex-builder')
  await closeAllDialogs()
})

scene('history-deepen', async () => {
  await ensureRepository()
  await menuEvent('show-repository-tools')
  await sleep(1500)
  await clickText('Deepen a shallow repository', { optional: true })
  await sleep(1200)
  ;(await clickText('Fetch 25 older commits', { optional: true })) ||
    (await clickText('Deepen by 25', { optional: true })) ||
    (await clickText('Deepen', { optional: true }))
  await sleep(3500)
  await parkPointer()
  await capture('material-history-deepen')
})

scene('history-deepening', async () => {
  await ensureRepository()
  await menuEvent('show-repository-tools')
  await sleep(1200)
  await clickText('Deepen a shallow repository', { optional: true })
  await sleep(1000)
  ;(await clickText('Fetch all remaining history', { optional: true })) ||
    (await clickText('Fetch all history', { optional: true })) ||
    (await clickText('Unshallow', { optional: true }))
  await sleep(4500)
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
  await capture('material-actions-artifact-page-two')
  await capture('material-actions-artifacts-headless')
})

scene('actions-sentinel', async () => {
  await captureSection('Actions', null, 2500)
  for (let round = 0; round < 4; round++) {
    const more = await clickText('Load more runs', { optional: true })
    if (!more) {
      break
    }
    await sleep(2500)
  }
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
  await captureSection('Actions', null, 2500)
  // Not every synthetic run serves logs; walk runs until the viewer has
  // real content instead of the transfer error.
  for (let index = 0; index < 4; index++) {
    await evaluate(`(() => {
      const rows = [...document.querySelectorAll('button.actions-run-select')]
      const row = rows[${index}]
      if (row instanceof HTMLElement) row.click()
      return true
    })()`)
    await sleep(2500)
    const openedLog =
      (await clickText('View logs', { optional: true })) ||
      (await clickAria('View logs', { optional: true }))
    if (!openedLog) {
      continue
    }
    await sleep(2500)
    const failed = await evaluate(
      `/could not transfer/i.test(document.body.textContent ?? '')`
    )
    if (!failed) {
      break
    }
    await clickText('Close', { optional: true })
    await sleep(700)
  }
  await parkPointer()
  await capture('material-actions-job-log')
  await closeAllDialogs()
})

scene('actions-cancel', async () => {
  await captureSection('Actions', null, 2500)
  for (let round = 0; round < 4; round++) {
    const found = await evaluate(`(() => {
      return [...document.querySelectorAll('.actions-view button')]
        .some(b => /cancel/i.test(b.getAttribute('aria-label') ?? b.textContent ?? ''))
    })()`)
    if (found) {
      break
    }
    const more = await clickText('Load more runs', { optional: true })
    if (!more) {
      break
    }
    await sleep(2500)
  }
  const requested = await evaluate(`(() => {
    const cancel = [...document.querySelectorAll('.actions-view button')]
      .find(b => /cancel/i.test(b.getAttribute('aria-label') ?? b.textContent ?? ''))
    if (cancel instanceof HTMLElement) { cancel.click(); return true }
    return false
  })()`)
  if (!requested) {
    process.stdout.write('WARN no cancellable run found\n')
    return
  }
  await sleep(1500)
  await parkPointer()
  await capture('material-actions-cancel')
  ;(await clickText('Keep running', { optional: true })) ||
    (await clickText('Go back', { optional: true })) ||
    (await closeAllDialogs())
})

scene('actions-pending-deployments', async () => {
  await captureSection('Actions', null, 2500)
  await evaluate(`(() => {
    const waiting = [...document.querySelectorAll('.actions-run-column .list-item, .actions-run-column li, .actions-run-column article')]
      .find(r => /waiting|pending|review/i.test(r.textContent ?? ''))
    if (waiting instanceof HTMLElement) { waiting.click(); return true }
    return false
  })()`)
  await sleep(2500)
  ;(await clickText('Review deployments', { optional: true })) ||
    (await clickText('Review pending deployments', { optional: true }))
  await sleep(1800)
  await parkPointer()
  await capture('material-actions-pending-deployments')
  await closeAllDialogs()
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
  await clickText('View logs', { optional: true })
  await sleep(2500)
  await parkPointer()
  await capture('material-actions-job-log')
  await clickText('Close', { optional: true })
  await sleep(600)
})

scene('raw-deployments', async () => {
  ;(await clickText('Review deployments', { optional: true })) ||
    (await clickText('Review pending deployments', { optional: true })) ||
    (await evaluate(`(() => {
      const b = [...document.querySelectorAll('button')].find(x => /deployment/i.test(x.textContent ?? ''))
      if (b instanceof HTMLElement) { b.click(); return true }
      return false
    })()`))
  await sleep(1800)
  await parkPointer()
  await capture('material-actions-pending-deployments')
  await closeAllDialogs()
})

scene('merge-all', async () => {
  await ensureRepository()
  await menuEvent('show-worktrees')
  await sleep(1500)
  await clickText('Merge all worktrees', { optional: true })
  await sleep(2500)
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
  await waitFor(
    `[...document.querySelectorAll('.tag-lifecycle-manager button')].some(button => button.textContent.trim() === 'Load remote' && !button.disabled)`,
    'enabled remote tag inventory action',
    30000
  )
  await clickText('Load remote', { within: '.tag-lifecycle-manager' })
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
    `document.body.textContent?.includes(${JSON.stringify(
      largeFileName
    )}) === true`,
    'synthetic oversized file in Changes',
    30000
  )
  await setInput(
    'input[aria-label="Commit summary"]',
    'Route large ISO through cheap LFS'
  )
  await waitFor(
    `document.querySelector('.commit-button') instanceof HTMLButtonElement && !document.querySelector('.commit-button').disabled`,
    'enabled cheap-LFS commit action'
  )
  await clickSelector('.commit-button')
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
