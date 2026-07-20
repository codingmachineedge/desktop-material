#!/usr/bin/env node
'use strict'

/**
 * Attach-only production verifier for the full Ollama model manager.
 *
 * The caller owns Electron, its isolated profile, the hidden Win32 desktop,
 * both deterministic fixtures, and cleanup. This helper only attaches to the
 * explicitly supplied loopback CDP port. It never launches, focuses, resizes,
 * closes, or terminates Electron and never switches or exposes a desktop.
 *
 * Usage:
 *   node .codex/verification/verify_ollama_manager_cdp.js \
 *     --port 9337 \
 *     --p0-run-root %TEMP%\desktop-material-p0-ui-... \
 *     --ollama-run-root %TEMP%\desktop-material-ollama-... \
 *     --capture %TEMP%\desktop-material-p0-ui-...\captures\ollama.png \
 *     --receipt %TEMP%\desktop-material-p0-ui-...\captures\ollama.json
 */

const crypto = require('crypto')
const fs = require('fs')
const http = require('http')
const os = require('os')
const path = require('path')
const zlib = require('zlib')

let runtimeTransport = null

function fail(message) {
  throw new Error(message)
}

function getRuntimeTransport() {
  runtimeTransport ??= require('./verify_actions_pagination_cdp.js')
  return runtimeTransport
}

function evaluate(client, expression) {
  return getRuntimeTransport().evaluate(client, expression)
}

function getJSON(port, target) {
  return getRuntimeTransport().getJSON(port, target)
}

const CaptureWidth = 1452
const CaptureHeight = 1001
const ProviderId = 'material-ollama-fixture'
const ProviderName = 'Material Ollama'
const BaseModels = Object.freeze([
  'material-chat:7b',
  'material-embed:latest',
  'material-vision:3b',
])
const PulledModel = 'material-code:1.5b'
const CopiedModel = 'material-verifier-copy:latest'
const RenamedModel = 'material-verifier-renamed:latest'
const P0RootPattern =
  /^desktop-material-p0-ui-[A-Za-z0-9][A-Za-z0-9._-]{5,120}$/
const OllamaRootPattern =
  /^desktop-material-ollama-[A-Za-z0-9][A-Za-z0-9._-]{5,120}$/
const AllowedArguments = Object.freeze(
  new Set(['port', 'p0-run-root', 'ollama-run-root', 'capture', 'receipt'])
)
const AllowedFixtureRequests = Object.freeze(
  new Set([
    'GET /__fixture__/audit',
    'GET /__fixture__/state',
    'POST /__fixture__/reset',
  ])
)

function parseArgumentPairs(argv) {
  if (argv.length % 2 !== 0) {
    fail(`Invalid argument near ${argv.at(-1) ?? '<end>'}.`)
  }
  const values = new Map()
  for (let index = 0; index < argv.length; index += 2) {
    const name = argv[index]
    const value = argv[index + 1]
    if (!name?.startsWith('--') || value === undefined) {
      fail(`Invalid argument near ${name ?? '<end>'}.`)
    }
    const key = name.slice(2)
    if (!AllowedArguments.has(key)) {
      fail(`Unknown argument: --${key}.`)
    }
    if (values.has(key)) {
      fail(`Argument --${key} may be supplied only once.`)
    }
    values.set(key, value)
  }
  for (const name of AllowedArguments) {
    if (!values.has(name)) {
      fail(`--${name} is required.`)
    }
  }
  return values
}

function assertRealItem(candidate, kind, label) {
  let item
  try {
    item = fs.lstatSync(candidate)
  } catch {
    fail(`${label} is missing.`)
  }
  if (
    item.isSymbolicLink() ||
    (kind === 'directory' ? !item.isDirectory() : !item.isFile())
  ) {
    fail(`${label} must be a real ${kind}, not a symlink or junction.`)
  }
  let resolved
  try {
    resolved = fs.realpathSync.native(candidate)
  } catch {
    fail(`${label} could not be resolved.`)
  }
  // Windows may expand an ordinary DOS 8.3 segment while resolving a path.
  // lstat above rejects reparse points, and every ownership comparison below
  // uses this canonical result, so that lexical change is safe and expected.
  if (process.platform !== 'win32' && resolved !== path.resolve(candidate)) {
    fail(`${label} changed during real-path resolution.`)
  }
  return resolved
}

function readOwnedRoot(requested, pattern, label) {
  const tempRoot = assertRealItem(os.tmpdir(), 'directory', 'TEMP')
  const resolved = assertRealItem(path.resolve(requested), 'directory', label)
  if (
    path.dirname(resolved).toLowerCase() !== tempRoot.toLowerCase() ||
    !pattern.test(path.basename(resolved))
  ) {
    fail(`${label} must be a direct TEMP child with its reviewed name prefix.`)
  }
  return resolved
}

function parseLoopbackURL(value, expectedPath, label) {
  let endpoint
  try {
    endpoint = new URL(value)
  } catch {
    fail(`${label} is not a valid URL.`)
  }
  if (
    endpoint.protocol !== 'http:' ||
    !['127.0.0.1', 'localhost', '::1'].includes(
      endpoint.hostname.toLowerCase()
    ) ||
    endpoint.pathname.replace(/\/$/, '') !== expectedPath ||
    endpoint.username !== '' ||
    endpoint.password !== '' ||
    endpoint.search !== '' ||
    endpoint.hash !== '' ||
    endpoint.port === ''
  ) {
    fail(
      `${label} must be an uncredentialed loopback ${expectedPath || '/'} URL.`
    )
  }
  return endpoint
}

function readJSONFile(file, label) {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'))
  } catch {
    fail(`${label} is not valid JSON.`)
  }
}

function readOwnedP0Fixture(requestedRoot) {
  const runRoot = readOwnedRoot(requestedRoot, P0RootPattern, 'P0 run root')
  const fixturePath = assertRealItem(
    path.join(runRoot, 'fixture'),
    'directory',
    'P0 cloned fixture'
  )
  const providerDirectory = assertRealItem(
    path.join(runRoot, 'provider'),
    'directory',
    'P0 provider directory'
  )
  const readyPath = assertRealItem(
    path.join(providerDirectory, 'ready.json'),
    'file',
    'P0 provider readiness receipt'
  )
  if (
    path.relative(runRoot, fixturePath).toLowerCase() !== 'fixture' ||
    path.relative(runRoot, providerDirectory).toLowerCase() !== 'provider' ||
    path.relative(runRoot, readyPath).toLowerCase() !==
      path.join('provider', 'ready.json').toLowerCase()
  ) {
    fail('The P0 fixture escaped its owned run root.')
  }
  const ready = readJSONFile(readyPath, 'P0 provider readiness receipt')
  const endpoint = parseLoopbackURL(
    ready.endpoint,
    '/api/v3',
    'P0 provider endpoint'
  )
  if (
    ready.bind !== '127.0.0.1' ||
    !Number.isSafeInteger(ready.pid) ||
    ready.pid < 1 ||
    !Number.isSafeInteger(ready.port) ||
    ready.port < 1 ||
    ready.port > 65535 ||
    endpoint.port !== String(ready.port) ||
    ready.copilotEnabled !== true ||
    ready.owner !== 'material-fixture-owner' ||
    ready.repository !== 'material-fixture' ||
    ready.accountLogin !== 'material-verifier-p0' ||
    ready.accountId !== 7130701
  ) {
    fail('The P0 provider failed its deterministic loopback identity contract.')
  }
  return Object.freeze({
    runRoot,
    fixturePath,
    rootName: path.basename(runRoot),
    endpoint: endpoint.toString().replace(/\/$/, ''),
    accountLogin: ready.accountLogin,
    accountId: ready.accountId,
  })
}

function readOwnedOllamaFixture(requestedRoot) {
  const runRoot = readOwnedRoot(
    requestedRoot,
    OllamaRootPattern,
    'Ollama run root'
  )
  const ownedDirectory = assertRealItem(
    path.join(runRoot, 'ollama'),
    'directory',
    'Ollama owned directory'
  )
  const readyPath = assertRealItem(
    path.join(ownedDirectory, 'ready.json'),
    'file',
    'Ollama readiness receipt'
  )
  const mutationLog = assertRealItem(
    path.join(ownedDirectory, 'mutations.jsonl'),
    'file',
    'Ollama mutation log'
  )
  if (
    path.relative(runRoot, ownedDirectory).toLowerCase() !== 'ollama' ||
    path.relative(runRoot, readyPath).toLowerCase() !==
      path.join('ollama', 'ready.json').toLowerCase() ||
    path.relative(runRoot, mutationLog).toLowerCase() !==
      path.join('ollama', 'mutations.jsonl').toLowerCase()
  ) {
    fail('The Ollama fixture escaped its owned run root.')
  }
  const ready = readJSONFile(readyPath, 'Ollama readiness receipt')
  const endpoint = parseLoopbackURL(ready.endpoint, '', 'Ollama endpoint')
  if (
    ready.fixture !== 'desktop-material-ollama' ||
    ready.protocolVersion !== 1 ||
    ready.runRootName !== path.basename(runRoot) ||
    ready.bind !== '127.0.0.1' ||
    !Number.isSafeInteger(ready.pid) ||
    ready.pid < 1 ||
    !Number.isSafeInteger(ready.port) ||
    ready.port < 1 ||
    ready.port > 65535 ||
    endpoint.port !== String(ready.port) ||
    ready.mutationLog !== 'ollama/mutations.jsonl' ||
    ready.version !== '0.12.6' ||
    ready.faultMode !== 'none' ||
    !Number.isSafeInteger(ready.minimumPullDurationMs) ||
    ready.minimumPullDurationMs < 1400 ||
    JSON.stringify(ready.seedModels) !== JSON.stringify(BaseModels) ||
    JSON.stringify(ready.runningModels) !==
      JSON.stringify(['material-chat:7b']) ||
    !Array.isArray(ready.pullableModels) ||
    !ready.pullableModels.includes(PulledModel)
  ) {
    fail(
      'The Ollama fixture failed its deterministic loopback identity contract.'
    )
  }
  return Object.freeze({
    runRoot,
    rootName: path.basename(runRoot),
    endpoint: endpoint.origin,
    port: ready.port,
    version: ready.version,
    minimumPullDurationMs: ready.minimumPullDurationMs,
  })
}

function validateOwnedOutput(value, p0, extension, label) {
  const resolved = path.resolve(value)
  if (path.extname(resolved).toLowerCase() !== extension) {
    fail(`${label} must use the ${extension} extension.`)
  }
  if (fs.existsSync(resolved)) {
    fail(`${label} already exists.`)
  }
  const parent = assertRealItem(
    path.dirname(resolved),
    'directory',
    `${label} parent`
  )
  const expectedParent = path.join(p0.runRoot, 'captures')
  if (
    parent.toLowerCase() !== expectedParent.toLowerCase() ||
    path.dirname(parent).toLowerCase() !== p0.runRoot.toLowerCase()
  ) {
    fail(`${label} must be a direct child of the owned P0 captures directory.`)
  }
  const name = path.basename(resolved)
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]{5,120}$/.test(name)) {
    fail(`${label} has an unsafe file name.`)
  }
  return resolved
}

function parseArguments(argv) {
  const values = parseArgumentPairs(argv)
  const port = Number(values.get('port'))
  if (!Number.isSafeInteger(port) || port < 1 || port > 65535) {
    fail('A valid loopback CDP port is required.')
  }
  const p0 = readOwnedP0Fixture(values.get('p0-run-root'))
  const ollama = readOwnedOllamaFixture(values.get('ollama-run-root'))
  const capturePath = validateOwnedOutput(
    values.get('capture'),
    p0,
    '.png',
    'Capture path'
  )
  const receiptPath = validateOwnedOutput(
    values.get('receipt'),
    p0,
    '.json',
    'Receipt path'
  )
  if (capturePath.toLowerCase() === receiptPath.toLowerCase()) {
    fail('Capture and receipt paths must differ.')
  }
  return Object.freeze({ port, p0, ollama, capturePath, receiptPath })
}

function validateCDPTarget(target, port) {
  let page
  let websocket
  try {
    page = new URL(target.url)
    websocket = new URL(target.webSocketDebuggerUrl)
  } catch {
    fail('The Desktop Material CDP target contains an invalid URL.')
  }
  if (
    target.type !== 'page' ||
    page.protocol !== 'file:' ||
    !page.pathname.replaceAll('\\', '/').endsWith('/out/index.html') ||
    websocket.protocol !== 'ws:' ||
    !['127.0.0.1', 'localhost', '::1'].includes(
      websocket.hostname.toLowerCase()
    ) ||
    websocket.port !== String(port) ||
    !websocket.pathname.startsWith('/devtools/page/') ||
    websocket.username !== '' ||
    websocket.password !== '' ||
    websocket.search !== '' ||
    websocket.hash !== ''
  ) {
    fail(
      'The Desktop Material target failed its loopback attach-only contract.'
    )
  }
  return target
}

function requestOllamaFixture(ollama, method, target, body = null) {
  if (!AllowedFixtureRequests.has(`${method} ${target}`)) {
    fail(
      `The verifier attempted an unreviewed fixture request: ${method} ${target}.`
    )
  }
  const payload = body === null ? null : Buffer.from(JSON.stringify(body))
  return new Promise((resolve, reject) => {
    const request = http.request(
      {
        hostname: '127.0.0.1',
        port: ollama.port,
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

function assertCanonicalFixtureState(state, label) {
  if (
    state?.fixture !== 'desktop-material-ollama' ||
    JSON.stringify(state.installedModels) !== JSON.stringify(BaseModels) ||
    JSON.stringify(state.runningModels) !==
      JSON.stringify(['material-chat:7b']) ||
    JSON.stringify(state.activePulls) !== JSON.stringify([]) ||
    state.faultMode !== 'none'
  ) {
    fail(`Ollama fixture ${label} was not canonical: ${JSON.stringify(state)}`)
  }
}

async function waitForExpression(client, expression, label, timeout = 30000) {
  const deadline = Date.now() + timeout
  let lastError = null
  while (Date.now() < deadline) {
    try {
      if (await evaluate(client, expression)) {
        return
      }
    } catch (error) {
      lastError = String(error)
    }
    await new Promise(resolve => setTimeout(resolve, 150))
  }
  let diagnostic
  try {
    diagnostic = await evaluate(
      client,
      `(() => ({
        readyState: document.readyState,
        hash: location.hash,
        bodyText: (document.body?.innerText || '').replace(/\\s+/g, ' ')
          .trim().slice(0, 1800),
        buttons: [...document.querySelectorAll('button')]
          .filter(button => button.offsetWidth > 0 && button.offsetHeight > 0)
          .map(button => (button.textContent || button.getAttribute('aria-label') || '')
            .trim()).filter(Boolean).slice(0, 80),
        managerBusy: document.querySelector('[data-verification="ollama-manager"]')
          ?.getAttribute('aria-busy') ?? null,
        models: [...document.querySelectorAll('[data-verification="ollama-model-row"]')]
          .map(row => row.getAttribute('data-model')),
        notice: document.querySelector('[data-verification="ollama-notice"]')
          ?.textContent?.trim() ?? null
      }))()`
    )
  } catch (error) {
    diagnostic = { unavailable: String(error) }
  }
  fail(
    `Timed out waiting for ${label}: ${JSON.stringify({
      lastError,
      diagnostic,
    })}`
  )
}

async function clickSelector(client, selector, label) {
  const clicked = await evaluate(
    client,
    `(() => {
      const element = document.querySelector(${JSON.stringify(selector)})
      if (!(element instanceof HTMLElement) ||
          (element instanceof HTMLButtonElement && element.disabled) ||
          element.getAttribute('aria-disabled') === 'true') return false
      element.scrollIntoView({ block: 'nearest', inline: 'nearest' })
      element.click()
      return true
    })()`
  )
  if (!clicked) {
    fail(`Unable to activate ${label}.`)
  }
}

async function clickText(client, text, within) {
  const clicked = await evaluate(
    client,
    `(() => {
      const root = document.querySelector(${JSON.stringify(within)})
      if (!(root instanceof HTMLElement)) return false
      const element = [...root.querySelectorAll('button')].find(button =>
        button.textContent.trim() === ${JSON.stringify(text)} &&
        !button.disabled && button.getAttribute('aria-disabled') !== 'true'
      )
      if (!(element instanceof HTMLButtonElement)) return false
      element.scrollIntoView({ block: 'nearest', inline: 'nearest' })
      element.click()
      return true
    })()`
  )
  if (!clicked) {
    fail(`Unable to activate ${text} within ${within}.`)
  }
}

async function setInput(client, selector, value) {
  const changed = await evaluate(
    client,
    `(() => {
      const element = document.querySelector(${JSON.stringify(selector)})
      if (!(element instanceof HTMLInputElement)) return false
      const setter = Object.getOwnPropertyDescriptor(
        HTMLInputElement.prototype, 'value'
      ).set
      setter.call(element, ${JSON.stringify(value)})
      element.dispatchEvent(new Event('input', { bubbles: true }))
      element.dispatchEvent(new Event('change', { bubbles: true }))
      return element.value === ${JSON.stringify(value)}
    })()`
  )
  if (!changed) {
    fail(`Unable to set ${selector}.`)
  }
}

async function setSelect(client, selector, value) {
  const changed = await evaluate(
    client,
    `(() => {
      const element = document.querySelector(${JSON.stringify(selector)})
      if (!(element instanceof HTMLSelectElement) ||
          ![...element.options].some(option => option.value === ${JSON.stringify(
            value
          )})) return false
      const setter = Object.getOwnPropertyDescriptor(
        HTMLSelectElement.prototype, 'value'
      ).set
      setter.call(element, ${JSON.stringify(value)})
      element.dispatchEvent(new Event('change', { bubbles: true }))
      return element.value === ${JSON.stringify(value)}
    })()`
  )
  if (!changed) {
    fail(`Unable to select ${value} in ${selector}.`)
  }
}

function providerModelsExpression(expectedModels, endpoint) {
  return `(() => {
    let providers
    try {
      providers = JSON.parse(localStorage.getItem('copilot-byok-providers') || '[]')
    } catch { return false }
    const provider = Array.isArray(providers)
      ? providers.find(value => value?.id === ${JSON.stringify(ProviderId)})
      : null
    return provider?.name === ${JSON.stringify(ProviderName)} &&
      provider?.type === 'openai' && provider?.integration === 'ollama' &&
      provider?.authKind === 'none' &&
      provider?.baseUrl === ${JSON.stringify(`${endpoint}/v1`)} &&
      JSON.stringify((provider.models || []).map(model => model.id)) ===
        JSON.stringify(${JSON.stringify(expectedModels)}) &&
      (provider.models || []).every(model => model.id === model.name)
  })()`
}

async function waitForProviderModels(client, expectedModels, endpoint, label) {
  await waitForExpression(
    client,
    providerModelsExpression(expectedModels, endpoint),
    `provider synchronization after ${label}`
  )
  return [...expectedModels]
}

async function seedIsolatedProfile(client, options) {
  const provider = {
    id: ProviderId,
    name: ProviderName,
    type: 'openai',
    integration: 'ollama',
    baseUrl: `${options.ollama.endpoint}/v1`,
    wireApi: 'completions',
    authKind: 'none',
    models: [],
  }
  const user = {
    token: '',
    login: options.p0.accountLogin,
    endpoint: options.p0.endpoint,
    emails: [
      {
        email: 'material-verifier@example.invalid',
        verified: true,
        primary: true,
        visibility: 'private',
      },
    ],
    avatarURL: '',
    id: options.p0.accountId,
    name: 'Material Verification Account',
    plan: 'enterprise',
    provider: 'github',
  }
  const beforeTimeOrigin = await evaluate(client, 'performance.timeOrigin')
  const changed = await evaluate(
    client,
    `(() => {
      const expected = {
        'has-shown-welcome-flow': '1',
        'theme': 'dark',
        'language-mode-v1': 'english',
        'zoom-factor': '1',
        'zoom-auto-fit-enabled': '0',
        'stats-opt-out': '1',
        'has-sent-stats-opt-in-ping': '1',
        'users': ${JSON.stringify(JSON.stringify([user]))},
        'copilot-byok-providers': ${JSON.stringify(JSON.stringify([provider]))}
      }
      let changed = false
      if (localStorage.getItem('autoSwitchTheme') !== null) {
        localStorage.removeItem('autoSwitchTheme')
        changed = true
      }
      for (const [key, value] of Object.entries(expected)) {
        if (localStorage.getItem(key) !== value) {
          localStorage.setItem(key, value)
          changed = true
        }
      }
      return changed
    })()`
  )
  if (changed) {
    await client.send('Page.reload', { ignoreCache: true })
    await waitForExpression(
      client,
      `performance.timeOrigin > ${JSON.stringify(beforeTimeOrigin)} &&
        document.readyState === 'complete' &&
        document.querySelector('#desktop-app-container') !== null &&
        document.body.classList.contains('theme-dark')`,
      'reloaded isolated dark profile',
      35000
    )
  } else {
    await waitForExpression(
      client,
      `document.readyState === 'complete' &&
        document.querySelector('#desktop-app-container') !== null &&
        document.body.classList.contains('theme-dark')`,
      'isolated dark profile'
    )
  }
  return { changed, provider, userLogin: user.login }
}

async function openManager(client) {
  const emitted = await evaluate(
    client,
    `(() => {
      const electron = require('electron')
      if (!electron?.ipcRenderer) return false
      electron.ipcRenderer.emit('menu-event', {}, 'show-preferences')
      return true
    })()`
  )
  if (!emitted) {
    fail('The app-native Preferences hook was unavailable.')
  }
  await waitForExpression(
    client,
    `document.querySelector('#preferences') !== null`,
    'Preferences dialog'
  )
  await clickSelector(
    client,
    '#preferences-tab-copilot',
    'Copilot preferences tab'
  )
  await waitForExpression(
    client,
    `document.querySelector('#preferences-tab-copilot')
      ?.closest('button[role="tab"]')
      ?.getAttribute('aria-selected') === 'true'`,
    'selected Copilot preferences tab'
  )
  await clickText(client, 'Providers', '#preferences')
  await waitForExpression(
    client,
    `(() => {
      const root = document.querySelector('#preferences')
      const tab = [...(root?.querySelectorAll('button[role="tab"]') ?? [])]
        .find(value => value.textContent.trim() === 'Providers')
      return tab?.getAttribute('aria-selected') === 'true' &&
        [...(root?.querySelectorAll('.copilot-byok-entry') ?? [])].some(row =>
          row.textContent.includes(${JSON.stringify(ProviderName)}) &&
          [...row.querySelectorAll('button')].some(button =>
            button.textContent.trim() === 'Manage models' && !button.disabled))
    })()`,
    'deterministic Ollama provider row',
    40000
  )
  const opened = await evaluate(
    client,
    `(() => {
      const row = [...document.querySelectorAll('.copilot-byok-entry')].find(value =>
        value.textContent.includes(${JSON.stringify(ProviderName)}))
      const button = [...(row?.querySelectorAll('button') ?? [])].find(value =>
        value.textContent.trim() === 'Manage models' && !value.disabled)
      if (!(button instanceof HTMLButtonElement)) return false
      button.click()
      return true
    })()`
  )
  if (!opened) {
    fail('The deterministic Ollama manager action was unavailable.')
  }
  await waitForExpression(
    client,
    `document.querySelector('[data-verification="ollama-manager"]') !== null`,
    'Ollama model manager'
  )
}

const InitialManagerExpression = `(() => {
  const manager = document.querySelector('[data-verification="ollama-manager"]')
  const rows = [...document.querySelectorAll('[data-verification="ollama-model-row"]')]
  const names = rows.map(row => row.getAttribute('data-model'))
  const refresh = document.querySelector('[data-verification="ollama-refresh"]')
  const details = document.querySelector('[data-verification="ollama-details"]')
  return manager?.getAttribute('aria-busy') === 'false' &&
    refresh instanceof HTMLButtonElement && !refresh.disabled &&
    document.querySelector('[data-verification="ollama-endpoint-status"]')
      ?.textContent?.trim() === 'Connected' &&
    document.querySelector('.ollama-endpoint-metrics')?.textContent
      ?.includes('0.12.6') === true &&
    JSON.stringify(names) === ${JSON.stringify(JSON.stringify(BaseModels))} &&
    rows[0]?.getAttribute('aria-pressed') === 'true' &&
    details?.textContent?.includes('material-chat:7b') === true &&
    details?.textContent?.includes('7B') === true &&
    details?.textContent?.includes('Q4_K_M') === true &&
    details?.textContent?.includes('completion') === true &&
    details?.textContent?.includes('tools') === true &&
    document.querySelector('.ollama-details-state') === null
})()`

async function exerciseSearchAndScope(client) {
  await setInput(client, '[data-verification="ollama-filter"]', 'vision')
  await waitForExpression(
    client,
    `(() => {
      const rows = [...document.querySelectorAll('[data-verification="ollama-model-row"]')]
      return rows.length === 1 &&
        rows[0].getAttribute('data-model') === 'material-vision:3b' &&
        document.querySelector('.ollama-inventory-count')?.textContent?.trim() ===
          'Showing 1 of 3 models'
    })()`,
    'capability search result'
  )
  await setInput(client, '[data-verification="ollama-filter"]', '')
  await setSelect(client, '[data-verification="ollama-scope"]', 'running')
  await waitForExpression(
    client,
    `(() => {
      const rows = [...document.querySelectorAll('[data-verification="ollama-model-row"]')]
      return rows.length === 1 &&
        rows[0].getAttribute('data-model') === 'material-chat:7b' &&
        rows[0].querySelector('.ollama-running-badge') !== null &&
        document.querySelector('.ollama-inventory-count')?.textContent?.trim() ===
          'Showing 1 of 3 models'
    })()`,
    'running-only inventory'
  )
  await setSelect(client, '[data-verification="ollama-scope"]', 'all')
  await waitForExpression(
    client,
    InitialManagerExpression,
    'restored inventory'
  )
  return { capabilitySearch: true, runningScope: true }
}

async function waitForFixtureState(ollama, predicate, label, timeout = 12000) {
  const deadline = Date.now() + timeout
  let state = null
  while (Date.now() < deadline) {
    state = await requestOllamaFixture(ollama, 'GET', '/__fixture__/state')
    if (predicate(state)) {
      return state
    }
    await new Promise(resolve => setTimeout(resolve, 150))
  }
  fail(`Timed out waiting for fixture ${label}: ${JSON.stringify(state)}`)
}

async function exercisePullCancellation(client, options) {
  await setInput(client, '[data-verification="ollama-pull-name"]', PulledModel)
  await clickSelector(client, '[data-verification="ollama-pull"]', 'pull model')
  await waitForExpression(
    client,
    `(() => {
      const progress = document.querySelector(
        '[data-verification="ollama-pull-progress"] progress'
      )
      const cancel = document.querySelector(
        '[data-verification="ollama-pull-cancel"]'
      )
      return progress instanceof HTMLProgressElement &&
        cancel instanceof HTMLButtonElement && !cancel.disabled
    })()`,
    'cancellable pull progress'
  )
  await clickSelector(
    client,
    '[data-verification="ollama-pull-cancel"]',
    'cancel pull'
  )
  await waitForExpression(
    client,
    `(() => {
      const manager = document.querySelector('[data-verification="ollama-manager"]')
      const notice = document.querySelector('[data-verification="ollama-notice"]')
      return manager?.getAttribute('aria-busy') === 'false' &&
        notice?.textContent?.includes('canceled') === true &&
        document.querySelector('[data-verification="ollama-pull-progress"]') === null &&
        document.querySelectorAll('[data-verification="ollama-model-row"]').length === 3
    })()`,
    'completed pull cancellation'
  )
  const state = await waitForFixtureState(
    options.ollama,
    value =>
      JSON.stringify(value?.activePulls) === JSON.stringify([]) &&
      value?.installedModels?.includes(PulledModel) !== true,
    'pull cancellation rollback'
  )
  assertCanonicalFixtureState(state, 'after UI pull cancellation')
  await waitForProviderModels(
    client,
    BaseModels,
    options.ollama.endpoint,
    'pull cancellation'
  )
  return { visibleProgress: true, cancelled: true, atomicRollback: true }
}

async function exerciseSuccessfulPull(client, options) {
  await setInput(client, '[data-verification="ollama-pull-name"]', PulledModel)
  await clickSelector(client, '[data-verification="ollama-pull"]', 'pull model')
  await waitForExpression(
    client,
    `(() => {
      const progress = document.querySelector(
        '[data-verification="ollama-pull-progress"] progress'
      )
      return progress instanceof HTMLProgressElement &&
        Number(progress.max) > 0 && Number(progress.value) > 0 &&
        Number(progress.value) < Number(progress.max)
    })()`,
    'advancing bounded pull progress',
    Math.max(30000, options.ollama.minimumPullDurationMs + 10000)
  )
  const progress = await evaluate(
    client,
    `(() => {
      const progress = document.querySelector(
        '[data-verification="ollama-pull-progress"] progress'
      )
      return { value: Number(progress.value), max: Number(progress.max) }
    })()`
  )
  await waitForExpression(
    client,
    `(() => {
      const manager = document.querySelector('[data-verification="ollama-manager"]')
      const notice = document.querySelector('[data-verification="ollama-notice"]')
      const row = document.querySelector(
        '[data-verification="ollama-model-row"][data-model=${JSON.stringify(
          PulledModel
        )}]'
      )
      return manager?.getAttribute('aria-busy') === 'false' &&
        row instanceof HTMLButtonElement &&
        notice?.textContent?.includes(${JSON.stringify(
          `Installed ${PulledModel}.`
        )}) === true &&
        document.querySelector('[data-verification="ollama-pull-progress"]') === null
    })()`,
    'successful model pull',
    Math.max(30000, options.ollama.minimumPullDurationMs + 15000)
  )
  const models = [...BaseModels, PulledModel].sort()
  await waitForProviderModels(
    client,
    models,
    options.ollama.endpoint,
    'successful pull'
  )
  return {
    advancedProgress: progress,
    installed: PulledModel,
    providerModels: models,
  }
}

async function selectModel(client, name, label) {
  const selector = `[data-verification="ollama-model-row"][data-model=${JSON.stringify(
    name
  )}]`
  await clickSelector(client, selector, label)
  await waitForExpression(
    client,
    `document.querySelector(${JSON.stringify(
      selector
    )})?.getAttribute('aria-pressed') === 'true' &&
      document.querySelector('[data-verification="ollama-details"]')
        ?.textContent?.includes(${JSON.stringify(name)}) === true &&
      document.querySelector('.ollama-details-state') === null`,
    `selected ${name}`
  )
}

async function exerciseCopyAndRename(client, options) {
  await selectModel(client, PulledModel, 'pulled model')
  await setInput(client, '[data-verification="ollama-copy-name"]', CopiedModel)
  await clickSelector(client, '[data-verification="ollama-copy"]', 'copy model')
  await waitForExpression(
    client,
    `(() => {
      const notice = document.querySelector('[data-verification="ollama-notice"]')
      return document.querySelector('[data-verification="ollama-manager"]')
          ?.getAttribute('aria-busy') === 'false' &&
        document.querySelector(
          '[data-verification="ollama-model-row"][data-model=${JSON.stringify(
            CopiedModel
          )}]'
        ) instanceof HTMLButtonElement &&
        notice?.textContent?.includes(${JSON.stringify(
          `Copied ${PulledModel} to ${CopiedModel}.`
        )}) === true
    })()`,
    'copied model'
  )
  const afterCopy = [...BaseModels, PulledModel, CopiedModel].sort()
  await waitForProviderModels(
    client,
    afterCopy,
    options.ollama.endpoint,
    'copy'
  )

  await selectModel(client, CopiedModel, 'copied model')
  await setInput(
    client,
    '[data-verification="ollama-rename-name"]',
    RenamedModel
  )
  await clickSelector(
    client,
    '[data-verification="ollama-rename"]',
    'rename model'
  )
  await waitForExpression(
    client,
    `(() => {
      const notice = document.querySelector('[data-verification="ollama-notice"]')
      return document.querySelector('[data-verification="ollama-manager"]')
          ?.getAttribute('aria-busy') === 'false' &&
        document.querySelector(
          '[data-verification="ollama-model-row"][data-model=${JSON.stringify(
            CopiedModel
          )}]'
        ) === null &&
        document.querySelector(
          '[data-verification="ollama-model-row"][data-model=${JSON.stringify(
            RenamedModel
          )}]'
        ) instanceof HTMLButtonElement &&
        notice?.textContent?.includes(${JSON.stringify(
          `Renamed ${CopiedModel} to ${RenamedModel}.`
        )}) === true
    })()`,
    'renamed model'
  )
  const afterRename = [...BaseModels, PulledModel, RenamedModel].sort()
  await waitForProviderModels(
    client,
    afterRename,
    options.ollama.endpoint,
    'rename'
  )
  return { source: PulledModel, copied: CopiedModel, renamed: RenamedModel }
}

async function exerciseLoadUnloadAndDelete(client, options) {
  await selectModel(client, RenamedModel, 'renamed model')
  await clickSelector(client, '[data-verification="ollama-load"]', 'load model')
  await waitForExpression(
    client,
    `(() => {
      const row = document.querySelector(
        '[data-verification="ollama-model-row"][data-model=${JSON.stringify(
          RenamedModel
        )}]'
      )
      const notice = document.querySelector('[data-verification="ollama-notice"]')
      return document.querySelector('[data-verification="ollama-manager"]')
          ?.getAttribute('aria-busy') === 'false' &&
        row?.querySelector('.ollama-running-badge') !== null &&
        notice?.textContent?.includes(${JSON.stringify(
          `Loaded ${RenamedModel}.`
        )}) === true
    })()`,
    'loaded renamed model'
  )
  await clickSelector(
    client,
    '[data-verification="ollama-unload"]',
    'unload model'
  )
  await waitForExpression(
    client,
    `(() => {
      const row = document.querySelector(
        '[data-verification="ollama-model-row"][data-model=${JSON.stringify(
          RenamedModel
        )}]'
      )
      const notice = document.querySelector('[data-verification="ollama-notice"]')
      return document.querySelector('[data-verification="ollama-manager"]')
          ?.getAttribute('aria-busy') === 'false' &&
        row?.querySelector('.ollama-running-badge') === null &&
        notice?.textContent?.includes(${JSON.stringify(
          `Unloaded ${RenamedModel}.`
        )}) === true
    })()`,
    'unloaded renamed model'
  )

  await clickSelector(
    client,
    '[data-verification="ollama-delete"]',
    'request delete'
  )
  await waitForExpression(
    client,
    `(() => {
      const dialog = document.querySelector(
        '[data-verification="ollama-delete-dialog"][role="alertdialog"]'
      )
      const confirm = document.querySelector('[data-verification="ollama-delete-confirm"]')
      return dialog instanceof HTMLElement &&
        confirm instanceof HTMLButtonElement && document.activeElement === confirm &&
        dialog.textContent.includes(${JSON.stringify(RenamedModel)})
    })()`,
    'focused model delete confirmation'
  )
  const confirmation = await evaluate(
    client,
    `(() => ({
      role: document.querySelector('[data-verification="ollama-delete-dialog"]')
        ?.getAttribute('role') ?? null,
      focused: document.activeElement?.getAttribute('data-verification') ?? null,
      modelNamed: document.querySelector('[data-verification="ollama-delete-dialog"]')
        ?.textContent?.includes(${JSON.stringify(RenamedModel)}) === true
    }))()`
  )
  await clickSelector(
    client,
    '[data-verification="ollama-delete-confirm"]',
    'confirm delete'
  )
  await waitForExpression(
    client,
    `(() => {
      const notice = document.querySelector('[data-verification="ollama-notice"]')
      return document.querySelector('[data-verification="ollama-manager"]')
          ?.getAttribute('aria-busy') === 'false' &&
        document.querySelector(
          '[data-verification="ollama-model-row"][data-model=${JSON.stringify(
            RenamedModel
          )}]'
        ) === null &&
        document.querySelector('[data-verification="ollama-delete-dialog"]') === null &&
        notice?.textContent?.includes(${JSON.stringify(
          `Deleted ${RenamedModel}.`
        )}) === true
    })()`,
    'confirmed model deletion'
  )
  const afterDelete = [...BaseModels, PulledModel].sort()
  await waitForProviderModels(
    client,
    afterDelete,
    options.ollama.endpoint,
    'confirmed delete'
  )
  return { loaded: true, unloaded: true, confirmation, deleted: RenamedModel }
}

function assertAudit(events, startSequence) {
  const relevant = events
    .filter(event => Number(event.sequence) > startSequence)
    .filter(event => event.kind === 'mutation')
  const operationCounts = relevant.reduce((counts, event) => {
    counts[event.operation] = (counts[event.operation] ?? 0) + 1
    return counts
  }, {})
  const requiredCounts = {
    'pull-start': 2,
    'pull-cancelled': 1,
    'pull-complete': 1,
    copy: 2,
    delete: 2,
    load: 1,
    unload: 1,
  }
  for (const [operation, minimum] of Object.entries(requiredCounts)) {
    if ((operationCounts[operation] ?? 0) < minimum) {
      fail(
        `Ollama UI audit is missing ${operation}: ${JSON.stringify(
          operationCounts
        )}`
      )
    }
  }
  return {
    firstSequence: relevant[0]?.sequence ?? null,
    lastSequence: relevant.at(-1)?.sequence ?? null,
    eventCount: relevant.length,
    operationCounts,
  }
}

const FinalSurfaceExpression = String.raw`(() => {
  const manager = document.querySelector('[data-verification="ollama-manager"]')
  const preferences = document.querySelector('#preferences')
  const details = document.querySelector('[data-verification="ollama-details"]')
  const refresh = document.querySelector('[data-verification="ollama-refresh"]')
  const rows = [...document.querySelectorAll('[data-verification="ollama-model-row"]')]
  const visible = element => {
    if (!(element instanceof HTMLElement)) return false
    const style = getComputedStyle(element)
    const bounds = element.getBoundingClientRect()
    return style.display !== 'none' && style.visibility !== 'hidden' &&
      Number(style.opacity || 1) !== 0 && bounds.width > 0 && bounds.height > 0
  }
  const rectangle = element => {
    if (!(element instanceof HTMLElement)) return null
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
      clientHeight: element.clientHeight,
      scrollHeight: element.scrollHeight,
    }
  }
  const contained = bounds => bounds !== null && bounds.width > 0 &&
    bounds.height > 0 && bounds.left >= -0.5 && bounds.top >= -0.5 &&
    bounds.right <= innerWidth + 0.5 && bounds.bottom <= innerHeight + 0.5
  const controls = [...(manager?.querySelectorAll('button, input, select') ?? [])]
    .filter(visible)
    .map(element => ({
      tag: element.tagName,
      verification: element.getAttribute('data-verification'),
      name: (element.getAttribute('aria-label') ||
        element.labels?.[0]?.textContent || element.textContent || '').trim(),
      disabled: element.disabled === true ||
        element.getAttribute('aria-disabled') === 'true',
      bounds: rectangle(element),
    }))
  const overlaps = []
  for (let left = 0; left < controls.length; left++) {
    for (let right = left + 1; right < controls.length; right++) {
      const a = controls[left].bounds
      const b = controls[right].bounds
      const width = Math.min(a.right, b.right) - Math.max(a.left, b.left)
      const height = Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top)
      if (width > 1 && height > 1) {
        overlaps.push([controls[left].verification, controls[right].verification])
      }
    }
  }
  const bundledAsset = value =>
    /^file:\/\/\/[a-z]:\/(?:[^?#]*\/)?out\/static\/[a-z0-9._-]+\.(?:gif|ico|png|svg|webp)(?:[?#].*)?$/i.test(value)
  const visibleValues = [...document.querySelectorAll('input, textarea')]
    .filter(visible).map(element => element.value)
  const visibleAttributes = [...document.querySelectorAll('[title], a[href], img[src]')]
    .filter(visible)
    .flatMap(element => [element.getAttribute('title') || '',
      element.getAttribute('href') || '', element.getAttribute('src') || ''])
    .filter(value => !bundledAsset(value))
  const privacyText = [document.body.innerText, ...visibleValues,
    ...visibleAttributes].join('\n')
  const privateMatch = /C:\\Users\\|C:\/Users\/|ADMINI~1|AppData[\\/]|(?:^|[\\/])Temp[\\/]|desktop-material-(?:p0-ui|ollama)-|[A-Z0-9._%+-]+@(?!example\.invalid(?:\s|$))[A-Z0-9.-]+\.[A-Z]{2,}/i.exec(privacyText)
  const requiredVerifications = [
    'ollama-manager', 'ollama-refresh', 'ollama-endpoint-status',
    'ollama-pull-name', 'ollama-pull', 'ollama-filter', 'ollama-scope',
    'ollama-inventory', 'ollama-model-row', 'ollama-details',
    'ollama-load', 'ollama-unload', 'ollama-delete', 'ollama-copy-name',
    'ollama-copy', 'ollama-rename-name', 'ollama-rename'
  ]
  const missingVerifications = requiredVerifications.filter(value =>
    document.querySelector('[data-verification="' + value + '"]') === null)
  return {
    language: document.body.getAttribute('data-dm-language-mode'),
    themeDark: document.body.classList.contains('theme-dark'),
    innerWidth,
    innerHeight,
    devicePixelRatio,
    managerBusy: manager?.getAttribute('aria-busy') ?? null,
    endpointStatus: document.querySelector('[data-verification="ollama-endpoint-status"]')
      ?.textContent?.trim() ?? null,
    metrics: document.querySelector('.ollama-endpoint-metrics')?.textContent
      ?.replace(/\s+/g, ' ').trim() ?? null,
    metricValues: Object.fromEntries(
      [...document.querySelectorAll('.ollama-endpoint-metrics > div')].map(item => [
        item.querySelector('dt')?.textContent?.trim() ?? '',
        item.querySelector('dd')?.textContent?.trim() ?? '',
      ])
    ),
    count: document.querySelector('.ollama-inventory-count')?.textContent
      ?.trim() ?? null,
    models: rows.map(row => row.getAttribute('data-model')),
    selected: rows.filter(row => row.getAttribute('aria-pressed') === 'true')
      .map(row => row.getAttribute('data-model')),
    running: rows.filter(row => row.querySelector('.ollama-running-badge'))
      .map(row => row.getAttribute('data-model')),
    detailsText: details?.textContent?.replace(/\s+/g, ' ').trim() ?? null,
    manager: rectangle(manager),
    preferences: rectangle(preferences),
    managerContained: contained(rectangle(manager)),
    preferencesContained: contained(rectangle(preferences)),
    documentOverflow: document.documentElement.scrollWidth >
      document.documentElement.clientWidth + 1,
    bodyOverflow: document.body.scrollWidth > document.body.clientWidth + 1,
    managerOverflow: manager instanceof HTMLElement &&
      manager.scrollWidth > manager.clientWidth + 1,
    controls,
    controlsContained: controls.every(control => contained(control.bounds)),
    controlsNamed: controls.every(control => control.name.length > 0),
    overlaps,
    managerLabelled: manager?.getAttribute('aria-labelledby') !== null &&
      document.getElementById(manager.getAttribute('aria-labelledby')) !== null,
    detailsLabelled: details?.getAttribute('aria-labelledby') !== null &&
      document.getElementById(details.getAttribute('aria-labelledby')) !== null,
    filterLabelled: document.querySelector('[data-verification="ollama-filter"]')
      ?.labels?.length > 0,
    scopeLabelled: document.querySelector('[data-verification="ollama-scope"]')
      ?.labels?.length > 0,
    missingVerifications,
    noticeAbsent: document.querySelector('[data-verification="ollama-notice"]') === null,
    progressAbsent: document.querySelector('[data-verification="ollama-pull-progress"]') === null,
    confirmationAbsent: document.querySelector('[data-verification="ollama-delete-dialog"]') === null,
    activeFiniteAnimations: preferences?.getAnimations({ subtree: true })
      .filter(animation => {
        const iterations = animation.effect?.getTiming().iterations ?? 1
        return iterations !== Infinity &&
          (animation.pending || animation.playState === 'running')
      }).length ?? -1,
    privacySafe: privateMatch === null,
    privacyMatch: privateMatch?.[0] ?? null,
  }
})()`

function assertFinalSurface(receipt) {
  const expectedControls = new Set([
    'ollama-refresh',
    'ollama-pull-name',
    'ollama-pull',
    'ollama-filter',
    'ollama-scope',
    'ollama-model-row',
    'ollama-load',
    'ollama-unload',
    'ollama-delete',
    'ollama-copy-name',
    'ollama-copy',
    'ollama-rename-name',
    'ollama-rename',
  ])
  const presentControls = new Set(
    receipt?.controls.map(control => control.verification).filter(Boolean) ?? []
  )
  const allRequiredControls = [...expectedControls].every(value =>
    presentControls.has(value)
  )
  if (
    receipt?.language !== 'english' ||
    receipt.themeDark !== true ||
    receipt.innerWidth !== CaptureWidth ||
    receipt.innerHeight !== CaptureHeight ||
    typeof receipt.devicePixelRatio !== 'number' ||
    Math.abs(receipt.devicePixelRatio - 1) >= 0.001 ||
    receipt.managerBusy !== 'false' ||
    receipt.endpointStatus !== 'Connected' ||
    !receipt.metrics?.includes('0.12.6') ||
    receipt.metricValues?.Version !== '0.12.6' ||
    receipt.metricValues?.Installed !== '3' ||
    receipt.metricValues?.Running !== '1' ||
    receipt.count !== 'Showing 3 of 3 models' ||
    JSON.stringify(receipt.models) !== JSON.stringify(BaseModels) ||
    JSON.stringify(receipt.selected) !== JSON.stringify(['material-chat:7b']) ||
    JSON.stringify(receipt.running) !== JSON.stringify(['material-chat:7b']) ||
    !receipt.detailsText?.includes('material-chat:7b') ||
    !receipt.detailsText?.includes('7B') ||
    !receipt.detailsText?.includes('Q4_K_M') ||
    receipt.managerContained !== true ||
    receipt.preferencesContained !== true ||
    receipt.documentOverflow !== false ||
    receipt.bodyOverflow !== false ||
    receipt.managerOverflow !== false ||
    receipt.controlsContained !== true ||
    receipt.controlsNamed !== true ||
    receipt.overlaps.length !== 0 ||
    receipt.managerLabelled !== true ||
    receipt.detailsLabelled !== true ||
    receipt.filterLabelled !== true ||
    receipt.scopeLabelled !== true ||
    receipt.missingVerifications.length !== 0 ||
    receipt.noticeAbsent !== true ||
    receipt.progressAbsent !== true ||
    receipt.confirmationAbsent !== true ||
    receipt.activeFiniteAnimations !== 0 ||
    receipt.privacySafe !== true ||
    !allRequiredControls
  ) {
    fail(`Final Ollama surface failed its gate: ${JSON.stringify(receipt)}`)
  }
}

function paeth(left, above, upperLeft) {
  const estimate = left + above - upperLeft
  const leftDistance = Math.abs(estimate - left)
  const aboveDistance = Math.abs(estimate - above)
  const upperLeftDistance = Math.abs(estimate - upperLeft)
  return leftDistance <= aboveDistance && leftDistance <= upperLeftDistance
    ? left
    : aboveDistance <= upperLeftDistance
    ? above
    : upperLeft
}

function inspectPngBytes(bytes, expectedWidth, expectedHeight) {
  if (
    bytes.byteLength < 33 ||
    bytes.subarray(0, 8).toString('hex') !== '89504e470d0a1a0a'
  ) {
    fail('The capture is not a valid PNG.')
  }
  let offset = 8
  let header = null
  const compressed = []
  while (offset + 12 <= bytes.length) {
    const length = bytes.readUInt32BE(offset)
    const type = bytes.subarray(offset + 4, offset + 8).toString('ascii')
    const start = offset + 8
    const end = start + length
    if (end + 4 > bytes.length) {
      fail('The capture contains a truncated PNG chunk.')
    }
    const data = bytes.subarray(start, end)
    if (type === 'IHDR') {
      header = {
        width: data.readUInt32BE(0),
        height: data.readUInt32BE(4),
        bitDepth: data[8],
        colorType: data[9],
        compression: data[10],
        filter: data[11],
        interlace: data[12],
      }
    } else if (type === 'IDAT') {
      compressed.push(data)
    } else if (type === 'IEND') {
      break
    }
    offset = end + 4
  }
  if (
    header === null ||
    header.width !== expectedWidth ||
    header.height !== expectedHeight ||
    header.bitDepth !== 8 ||
    ![2, 6].includes(header.colorType) ||
    header.compression !== 0 ||
    header.filter !== 0 ||
    header.interlace !== 0 ||
    compressed.length === 0
  ) {
    fail(`The capture PNG contract failed: ${JSON.stringify(header)}`)
  }
  const channels = header.colorType === 6 ? 4 : 3
  const stride = header.width * channels
  const raw = zlib.inflateSync(Buffer.concat(compressed), {
    maxOutputLength: (stride + 1) * header.height,
  })
  if (raw.length !== (stride + 1) * header.height) {
    fail('The capture PNG decompressed to an unexpected size.')
  }
  let previous = Buffer.alloc(stride)
  let cursor = 0
  let minimum = 255
  let maximum = 0
  let darkPixels = 0
  let lightPixels = 0
  const colors = new Set()
  for (let rowIndex = 0; rowIndex < header.height; rowIndex++) {
    const filter = raw[cursor++]
    const encoded = raw.subarray(cursor, cursor + stride)
    cursor += stride
    const row = Buffer.allocUnsafe(stride)
    for (let index = 0; index < stride; index++) {
      const value = encoded[index]
      const left = index >= channels ? row[index - channels] : 0
      const above = previous[index]
      const upperLeft = index >= channels ? previous[index - channels] : 0
      switch (filter) {
        case 0:
          row[index] = value
          break
        case 1:
          row[index] = (value + left) & 0xff
          break
        case 2:
          row[index] = (value + above) & 0xff
          break
        case 3:
          row[index] = (value + Math.floor((left + above) / 2)) & 0xff
          break
        case 4:
          row[index] = (value + paeth(left, above, upperLeft)) & 0xff
          break
        default:
          fail(`The capture PNG uses unsupported filter ${filter}.`)
      }
    }
    for (let index = 0; index < stride; index += channels) {
      const red = row[index]
      const green = row[index + 1]
      const blue = row[index + 2]
      minimum = Math.min(minimum, red, green, blue)
      maximum = Math.max(maximum, red, green, blue)
      const luminance = (red * 2126 + green * 7152 + blue * 722) / 10000
      if (luminance < 8) {
        darkPixels++
      }
      if (luminance > 247) {
        lightPixels++
      }
      if (colors.size < 4096) {
        colors.add(`${red >> 3},${green >> 3},${blue >> 3}`)
      }
    }
    previous = row
  }
  const pixelCount = header.width * header.height
  const stats = {
    width: header.width,
    height: header.height,
    colorType: header.colorType,
    channelMinimum: minimum,
    channelMaximum: maximum,
    quantizedColorCount: colors.size,
    darkPixelRatio: Number((darkPixels / pixelCount).toFixed(6)),
    lightPixelRatio: Number((lightPixels / pixelCount).toFixed(6)),
  }
  if (
    maximum - minimum < 16 ||
    colors.size < 32 ||
    stats.darkPixelRatio > 0.98 ||
    stats.lightPixelRatio > 0.995
  ) {
    fail(`The capture appears blank or monochrome: ${JSON.stringify(stats)}`)
  }
  return stats
}

async function prepareAndCapture(client, capturePath) {
  await client.send('Emulation.setDeviceMetricsOverride', {
    width: CaptureWidth,
    height: CaptureHeight,
    deviceScaleFactor: 1,
    mobile: false,
    screenWidth: CaptureWidth,
    screenHeight: CaptureHeight,
  })
  await waitForExpression(
    client,
    `innerWidth === ${CaptureWidth} && innerHeight === ${CaptureHeight} &&
      Math.abs(devicePixelRatio - 1) < 0.001`,
    'exact Ollama capture viewport'
  )
  await evaluate(
    client,
    `(() => {
      for (const node of document.querySelectorAll(
        '#preferences .tab-container, #preferences .copilot-tab-content'
      )) {
        node.scrollTop = 0
        node.scrollLeft = 0
      }
      const active = document.activeElement
      if (active instanceof HTMLElement) active.blur()
      document.querySelectorAll('[role="tooltip"], .tooltip').forEach(node =>
        node.remove())
      return new Promise(resolve => requestAnimationFrame(() =>
        requestAnimationFrame(() => resolve(true))))
    })()`
  )
  await client.send('Input.dispatchMouseEvent', {
    type: 'mouseMoved',
    x: CaptureWidth - 2,
    y: CaptureHeight - 2,
  })
  await waitForExpression(
    client,
    `(() => {
      const dialog = document.querySelector('#preferences')
      return dialog instanceof HTMLElement &&
        dialog.getAnimations({ subtree: true }).filter(animation => {
          const iterations = animation.effect?.getTiming().iterations ?? 1
          return iterations !== Infinity &&
            (animation.pending || animation.playState === 'running')
        }).length === 0
    })()`,
    'stable finite-animation-free capture surface'
  )
  const surface = await evaluate(client, FinalSurfaceExpression)
  assertFinalSurface(surface)
  const screenshot = await client.send('Page.captureScreenshot', {
    format: 'png',
    fromSurface: true,
    captureBeyondViewport: false,
  })
  const bytes = Buffer.from(screenshot.data, 'base64')
  if (bytes.byteLength < 20000) {
    fail(`The capture was unexpectedly small: ${bytes.byteLength} bytes.`)
  }
  const pixelStats = inspectPngBytes(bytes, CaptureWidth, CaptureHeight)
  fs.writeFileSync(capturePath, bytes, { flag: 'wx' })
  return {
    bytes: bytes.byteLength,
    sha256: crypto.createHash('sha256').update(bytes).digest('hex'),
    dimensions: { width: CaptureWidth, height: CaptureHeight },
    pixelStats,
    surface,
  }
}

async function runVerification(client, options) {
  const reset = await requestOllamaFixture(
    options.ollama,
    'POST',
    '/__fixture__/reset',
    {}
  )
  assertCanonicalFixtureState(reset, 'before UI exercise')
  const auditBefore = await requestOllamaFixture(
    options.ollama,
    'GET',
    '/__fixture__/audit'
  )
  const auditStartSequence = Math.max(
    0,
    ...(auditBefore?.events ?? []).map(event => Number(event.sequence) || 0)
  )

  await client.send('Emulation.setDeviceMetricsOverride', {
    width: CaptureWidth,
    height: CaptureHeight,
    deviceScaleFactor: 1,
    mobile: false,
    screenWidth: CaptureWidth,
    screenHeight: CaptureHeight,
  })
  const seed = await seedIsolatedProfile(client, options)
  await openManager(client)
  await waitForExpression(
    client,
    InitialManagerExpression,
    'health, version, inventory, and selected model details',
    40000
  )
  const initialProviderModels = await waitForProviderModels(
    client,
    BaseModels,
    options.ollama.endpoint,
    'initial inventory'
  )
  const searchAndScope = await exerciseSearchAndScope(client)
  const cancellation = await exercisePullCancellation(client, options)
  const successfulPull = await exerciseSuccessfulPull(client, options)
  const copyAndRename = await exerciseCopyAndRename(client, options)
  const loadUnloadDelete = await exerciseLoadUnloadAndDelete(client, options)

  const auditAfter = await requestOllamaFixture(
    options.ollama,
    'GET',
    '/__fixture__/audit'
  )
  const audit = assertAudit(auditAfter?.events ?? [], auditStartSequence)

  const finalReset = await requestOllamaFixture(
    options.ollama,
    'POST',
    '/__fixture__/reset',
    {}
  )
  assertCanonicalFixtureState(finalReset, 'before final capture')
  await setInput(client, '[data-verification="ollama-filter"]', '')
  await setInput(client, '[data-verification="ollama-pull-name"]', '')
  await setSelect(client, '[data-verification="ollama-scope"]', 'all')
  await clickSelector(
    client,
    '[data-verification="ollama-refresh"]',
    'refresh inventory'
  )
  await waitForExpression(
    client,
    InitialManagerExpression,
    'canonical final manager state',
    40000
  )
  const finalProviderModels = await waitForProviderModels(
    client,
    BaseModels,
    options.ollama.endpoint,
    'final reset'
  )
  const capture = await prepareAndCapture(client, options.capturePath)
  return {
    protocolVersion: 1,
    verifier: 'desktop-material-ollama-manager',
    attachOnly: true,
    fixtures: {
      p0: {
        rootName: options.p0.rootName,
        accountLogin: options.p0.accountLogin,
        provider: 'loopback',
        profileSeed: seed.changed ? 'reloaded' : 'preseeded',
      },
      ollama: {
        rootName: options.ollama.rootName,
        version: options.ollama.version,
        endpoint: options.ollama.endpoint,
        minimumPullDurationMs: options.ollama.minimumPullDurationMs,
      },
    },
    proof: {
      health: 'connected',
      version: options.ollama.version,
      inventory: [...BaseModels],
      details: 'material-chat:7b',
      providerSync: {
        initial: initialProviderModels,
        afterPull: successfulPull.providerModels,
        final: finalProviderModels,
      },
      searchAndScope,
      cancellation,
      successfulPull,
      copyAndRename,
      loadUnloadDelete,
      audit,
    },
    capture: {
      fileName: path.basename(options.capturePath),
      bytes: capture.bytes,
      sha256: capture.sha256,
      dimensions: capture.dimensions,
      pixelStats: capture.pixelStats,
      geometry: {
        managerContained: capture.surface.managerContained,
        preferencesContained: capture.surface.preferencesContained,
        controlsContained: capture.surface.controlsContained,
        overlaps: capture.surface.overlaps.length,
        horizontalOverflow:
          capture.surface.documentOverflow ||
          capture.surface.bodyOverflow ||
          capture.surface.managerOverflow,
      },
      accessibility: {
        managerLabelled: capture.surface.managerLabelled,
        detailsLabelled: capture.surface.detailsLabelled,
        filterLabelled: capture.surface.filterLabelled,
        scopeLabelled: capture.surface.scopeLabelled,
        controlsNamed: capture.surface.controlsNamed,
      },
      privacySafe: capture.surface.privacySafe,
    },
  }
}

async function main() {
  const options = parseArguments(process.argv.slice(2))
  const targets = await getJSON(options.port, '/json/list')
  const candidates = targets.filter(
    target =>
      target?.type === 'page' &&
      typeof target.url === 'string' &&
      target.url.replaceAll('\\', '/').includes('/out/index.html') &&
      typeof target.webSocketDebuggerUrl === 'string'
  )
  if (candidates.length !== 1) {
    fail(
      `Expected exactly one Desktop Material page on the owned CDP port; found ${candidates.length}.`
    )
  }
  const target = validateCDPTarget(candidates[0], options.port)
  const client = new (getRuntimeTransport().CDPClient)(
    target.webSocketDebuggerUrl
  )
  await client.open()
  try {
    await client.send('Runtime.enable')
    await client.send('Page.enable')
    const receipt = await runVerification(client, options)
    fs.writeFileSync(
      options.receiptPath,
      `${JSON.stringify({ ok: true, ...receipt }, null, 2)}\n`,
      { flag: 'wx' }
    )
    process.stdout.write(
      `OLLAMA_MANAGER_RECEIPT ${JSON.stringify({ ok: true, ...receipt })}\n`
    )
  } finally {
    try {
      await client.send('Emulation.clearDeviceMetricsOverride')
    } finally {
      client.close()
    }
  }
}

if (require.main === module) {
  main().catch(error => {
    process.stderr.write(
      `OLLAMA_MANAGER_VERIFY_FAIL ${
        error?.stack || error?.message || String(error ?? 'Unknown error.')
      }\n`
    )
    process.exitCode = 1
  })
}

module.exports = {
  AllowedArguments,
  BaseModels,
  CaptureHeight,
  CaptureWidth,
  FinalSurfaceExpression,
  OllamaRootPattern,
  P0RootPattern,
  ProviderId,
  ProviderName,
  assertAudit,
  assertCanonicalFixtureState,
  assertFinalSurface,
  inspectPngBytes,
  parseArgumentPairs,
  parseArguments,
  parseLoopbackURL,
  providerModelsExpression,
  readOwnedOllamaFixture,
  readOwnedP0Fixture,
  validateCDPTarget,
  validateOwnedOutput,
}
