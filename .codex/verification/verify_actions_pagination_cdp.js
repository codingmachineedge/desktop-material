#!/usr/bin/env node
'use strict'

/**
 * Bounded CDP verifier for the isolated Actions pagination production gate.
 * It connects only to an explicitly supplied loopback port and never launches,
 * resizes, focuses, or terminates Electron itself.
 */

const fs = require('fs')
const http = require('http')
const path = require('path')
const WebSocket = require('ws')

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
  const port = Number(values.get('port'))
  const mode = values.get('mode')
  if (!Number.isSafeInteger(port) || port < 1 || port > 65535) {
    fail('A valid loopback CDP port is required.')
  }
  if (mode !== 'interact' && mode !== 'inspect') {
    fail('Mode must be interact or inspect.')
  }
  let fixtureAccount = null
  if (mode === 'interact') {
    const providerEndpoint = values.get('provider-endpoint')
    const accountLogin = values.get('account-login')
    const accountId = Number(values.get('account-id'))
    let parsedEndpoint
    try {
      parsedEndpoint = new URL(providerEndpoint)
    } catch {
      fail('A valid fixture provider endpoint is required.')
    }
    if (
      parsedEndpoint.protocol !== 'http:' ||
      !['127.0.0.1', 'localhost', '::1'].includes(
        parsedEndpoint.hostname.toLowerCase()
      ) ||
      parsedEndpoint.pathname.replace(/\/$/, '') !== '/api/v3' ||
      parsedEndpoint.username !== '' ||
      parsedEndpoint.password !== ''
    ) {
      fail(
        'The fixture provider must be an uncredentialed loopback /api/v3 URL.'
      )
    }
    if (!/^[A-Za-z0-9-]{1,39}$/.test(accountLogin ?? '')) {
      fail('A valid fixture account login is required.')
    }
    if (!Number.isSafeInteger(accountId) || accountId < 1) {
      fail('A valid fixture account id is required.')
    }
    fixtureAccount = {
      endpoint: parsedEndpoint.toString().replace(/\/$/, ''),
      login: accountLogin,
      id: accountId,
    }
  }
  return {
    port,
    mode,
    fixtureAccount,
    runCapture: values.get('run-capture'),
    artifactCapture: values.get('artifact-capture'),
    sentinelCapture: values.get('sentinel-capture'),
    inspectCapture: values.get('capture'),
  }
}

function getJSON(port, target) {
  return new Promise((resolve, reject) => {
    const request = http.get(
      {
        hostname: '127.0.0.1',
        port,
        path: target,
        timeout: 5_000,
      },
      response => {
        const chunks = []
        response.on('data', chunk => chunks.push(chunk))
        response.on('end', () => {
          if (response.statusCode !== 200) {
            reject(new Error(`CDP discovery returned ${response.statusCode}.`))
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
      request.destroy(new Error('CDP discovery timed out.'))
    )
    request.on('error', reject)
  })
}

class CDPClient {
  constructor(url) {
    this.socket = new WebSocket(url, { handshakeTimeout: 5_000 })
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
        pending.reject(
          new Error(message.error.message ?? 'CDP command failed.')
        )
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

async function evaluate(client, expression) {
  const result = await client.send('Runtime.evaluate', {
    expression,
    awaitPromise: true,
    returnByValue: true,
    userGesture: true,
  })
  if (result.exceptionDetails !== undefined) {
    fail(result.exceptionDetails.text ?? 'Renderer evaluation failed.')
  }
  return result.result?.value
}

async function waitFor(client, expression, label, timeout = 20_000) {
  const deadline = Date.now() + timeout
  while (Date.now() < deadline) {
    try {
      if (await evaluate(client, expression)) {
        return
      }
    } catch (error) {
      if (
        !String(error).includes('context') &&
        !String(error).includes('reload')
      ) {
        throw error
      }
    }
    await new Promise(resolve => setTimeout(resolve, 100))
  }
  let diagnostic = null
  try {
    diagnostic = await evaluate(
      client,
      `({
        readyState: document.readyState,
        title: document.title,
        hash: location.hash,
        bodyText: (document.body?.innerText || '').trim().slice(0, 1_000),
        buttons: [...document.querySelectorAll('button')]
          .filter(value => value.offsetWidth > 0 && value.offsetHeight > 0)
          .map(value => value.textContent.trim()).filter(Boolean).slice(0, 50),
        dialogs: [...document.querySelectorAll('[role="dialog"]')]
          .map(value => value.textContent.trim().slice(0, 300)),
        actionsTabPresent: document.querySelector('#actions-tab') !== null
      })`
    )
  } catch (error) {
    diagnostic = { unavailable: String(error) }
  }
  fail(`Timed out waiting for ${label}: ${JSON.stringify(diagnostic)}`)
}

async function seedIsolatedProfile(client, fixtureAccount) {
  const users = JSON.stringify([
    {
      token: '',
      login: fixtureAccount.login,
      endpoint: fixtureAccount.endpoint,
      emails: [
        {
          email: 'material-verifier@example.invalid',
          verified: true,
          primary: true,
          visibility: 'private',
        },
      ],
      avatarURL: '',
      id: fixtureAccount.id,
      name: 'Material Verification Account With Wrapped Identity',
      plan: 'enterprise',
      provider: 'github',
    },
  ])
  return evaluate(
    client,
    `(() => {
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
      const expectedUsers = ${users}
      let storedUsers = []
      try {
        storedUsers = JSON.parse(localStorage.getItem('users') || '[]')
      } catch {}
      const expectedAccount = expectedUsers[0]
      const accountPresent = Array.isArray(storedUsers) && storedUsers.some(
        value => value?.provider === expectedAccount.provider &&
          value?.endpoint === expectedAccount.endpoint &&
          value?.login === expectedAccount.login &&
          value?.id === expectedAccount.id
      )
      if (!accountPresent) {
        localStorage.setItem('users', JSON.stringify(expectedUsers))
        changed = true
      }
      return changed
    })()`
  )
}

async function clickButton(client, label) {
  const clicked = await evaluate(
    client,
    `(() => {
      const button = [...document.querySelectorAll('button')].find(value =>
        value.textContent.trim() === ${JSON.stringify(label)} &&
        value.getAttribute('aria-disabled') !== 'true' && !value.disabled
      )
      if (!button) return false
      button.scrollIntoView({ block: 'nearest', inline: 'nearest' })
      button.click()
      return true
    })()`
  )
  if (!clicked) {
    fail(`Unable to activate ${label}.`)
  }
}

async function clickButtonStartingWith(client, label) {
  const clicked = await evaluate(
    client,
    `(() => {
      const button = [...document.querySelectorAll('button')]
        .find(value => value.textContent.trim().startsWith(${JSON.stringify(
          label
        )}) && !value.disabled)
      if (!button) return false
      button.click()
      return true
    })()`
  )
  if (!clicked) fail(`Button starting with ${label} was unavailable.`)
}

function validateCapturePath(value, label) {
  if (value === undefined) {
    fail(`${label} is required.`)
  }
  const resolved = path.resolve(value)
  if (fs.existsSync(resolved)) {
    fail(`${label} already exists: ${resolved}`)
  }
  const parent = path.dirname(resolved)
  if (!fs.statSync(parent).isDirectory()) {
    fail(`${label} parent does not exist: ${parent}`)
  }
  return resolved
}

async function capture(client, file) {
  const result = await client.send('Page.captureScreenshot', {
    format: 'png',
    fromSurface: true,
    captureBeyondViewport: false,
  })
  const bytes = Buffer.from(result.data, 'base64')
  if (bytes.length < 10_000) {
    fail(`Screenshot was unexpectedly small: ${bytes.length} bytes.`)
  }
  fs.writeFileSync(file, bytes, { flag: 'wx' })
  return bytes.length
}

const geometryExpression = `(() => {
  const one = value => Math.round(value * 100) / 100
  const visible = element => {
    const style = getComputedStyle(element)
    const rect = element.getBoundingClientRect()
    return style.display !== 'none' && style.visibility !== 'hidden' &&
      rect.width > 0 && rect.height > 0 && rect.bottom > 0 && rect.right > 0 &&
      rect.top < innerHeight && rect.left < innerWidth
  }
  const label = element => {
    const text = (element.getAttribute('aria-label') || element.textContent || '').trim()
    return (element.id ? '#' + element.id : element.className?.toString() || element.tagName) +
      (text ? ':' + text.slice(0, 90) : '')
  }
  const selectors = [
    '.actions-view', '.actions-content', '.actions-run-column',
    '.actions-run-list', '.actions-run-pagination', '.actions-run-details',
    '.actions-artifacts', '.actions-artifact-pagination',
    '#actions-artifact-grid', '.actions-artifact-card',
    '.actions-artifact-buttons'
  ]
  const overflow = []
  for (const selector of selectors) {
    for (const element of document.querySelectorAll(selector)) {
      if (element.clientWidth > 0 && element.scrollWidth > element.clientWidth + 1) {
        overflow.push({ element: label(element), client: element.clientWidth, scroll: element.scrollWidth })
      }
    }
  }
  const clipped = []
  const required = document.querySelectorAll([
    '.actions-run-summary > strong', '.branch-chip', '.actions-actor',
    '.actions-run-pagination > span', '.actions-artifact-pagination > span',
    '.actions-artifact-card h4', '.actions-artifact-card code',
    '.actions-view button', '.actions-view h1', '.actions-view h2',
    '.actions-view h3', '.actions-view h4'
  ].join(','))
  for (const element of required) {
    if (element.clientWidth > 0 && (
      element.scrollWidth > element.clientWidth + 1 ||
      element.scrollHeight > element.clientHeight + 1
    )) {
      clipped.push({
        element: label(element), clientWidth: element.clientWidth,
        scrollWidth: element.scrollWidth, clientHeight: element.clientHeight,
        scrollHeight: element.scrollHeight
      })
    }
  }
  const outside = []
  for (const element of document.querySelectorAll([
    '.actions-header button', '.actions-filters select',
    '.actions-run-pagination button', '.actions-artifact-pagination button',
    '.actions-details-header button', '.actions-artifacts-header button',
    '.actions-view h1', '.actions-view h2', '.actions-view h3'
  ].join(','))) {
    if (!visible(element)) continue
    const rect = element.getBoundingClientRect()
    if (rect.left < -1 || rect.right > innerWidth + 1 || rect.top < -1 || rect.bottom > innerHeight + 1) {
      outside.push({ element: label(element), left: one(rect.left), right: one(rect.right), top: one(rect.top), bottom: one(rect.bottom) })
    }
  }
  const overlaps = []
  for (const pager of document.querySelectorAll('.actions-run-pagination, .actions-artifact-pagination')) {
    const children = [...pager.children].filter(visible)
    for (let left = 0; left < children.length; left++) {
      for (let right = left + 1; right < children.length; right++) {
        const a = children[left].getBoundingClientRect()
        const b = children[right].getBoundingClientRect()
        const width = Math.min(a.right, b.right) - Math.max(a.left, b.left)
        const height = Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top)
        if (width > 1 && height > 1) {
          overlaps.push({ left: label(children[left]), right: label(children[right]), width: one(width), height: one(height) })
        }
      }
    }
  }
  return {
    innerWidth, innerHeight, devicePixelRatio,
    documentClientWidth: document.documentElement.clientWidth,
    documentScrollWidth: document.documentElement.scrollWidth,
    bodyClientWidth: document.body.clientWidth,
    bodyScrollWidth: document.body.scrollWidth,
    runCountText: document.querySelector('.actions-run-pagination > span')?.textContent.trim() || null,
    artifactCountText: document.querySelector('.actions-artifact-pagination > span')?.textContent.trim() || null,
    runSentinel: document.body.innerText.includes('Page two sentinel verifies complete workflow run pagination'),
    artifactSentinel: document.body.innerText.includes('page-two-artifact-sentinel'),
    overflow, clipped, outside, overlaps
  }
})()`

function assertGeometry(receipt) {
  const failures = []
  if (receipt.documentScrollWidth !== receipt.documentClientWidth)
    failures.push('document width')
  if (receipt.bodyScrollWidth !== receipt.bodyClientWidth)
    failures.push('body width')
  for (const key of ['overflow', 'clipped', 'outside', 'overlaps']) {
    if (receipt[key].length > 0) failures.push(key)
  }
  if (failures.length > 0) {
    fail(
      `Geometry gate failed (${failures.join(', ')}): ${JSON.stringify(
        receipt
      )}`
    )
  }
}

async function interact(client, options) {
  const runCapture = validateCapturePath(options.runCapture, 'run-capture')
  const artifactCapture = validateCapturePath(
    options.artifactCapture,
    'artifact-capture'
  )
  const sentinelCapture = validateCapturePath(
    options.sentinelCapture,
    'sentinel-capture'
  )

  if (await seedIsolatedProfile(client, options.fixtureAccount)) {
    fail(
      'Initialized the isolated verification profile; restart the exact app with the same profile before retrying.'
    )
  }
  await waitFor(
    client,
    `document.querySelector('#actions-tab') !== null || [...document.querySelectorAll('button')].some(value => (value.textContent.trim() === 'Add repository' || value.textContent.trim().startsWith('Fetch origin')) && !value.disabled)`,
    'app shell or Add local repository confirmation'
  )
  if (
    await evaluate(
      client,
      `[...document.querySelectorAll('button')].some(value => value.textContent.trim() === 'Add repository' && !value.disabled)`
    )
  ) {
    await clickButton(client, 'Add repository')
  }
  if (
    !(await evaluate(client, `document.querySelector('#actions-tab') !== null`))
  ) {
    await waitFor(
      client,
      `[...document.querySelectorAll('button')].some(value => value.textContent.trim().startsWith('Fetch origin') && !value.disabled)`,
      'Fetch origin association action'
    )
    await clickButtonStartingWith(client, 'Fetch origin')
  }
  await waitFor(
    client,
    `document.querySelector('#actions-tab') !== null`,
    'Actions tab'
  )
  await evaluate(client, `document.querySelector('#actions-tab').click()`)
  await waitFor(
    client,
    `document.querySelector('.actions-view h1')?.textContent.trim() === 'GitHub Actions'`,
    'Actions view'
  )
  await waitFor(
    client,
    `document.querySelector('select[name="status"]') !== null`,
    'run filters'
  )
  await evaluate(
    client,
    `(() => {
    const select = document.querySelector('select[name="status"]')
    select.value = 'success'
    select.dispatchEvent(new Event('change', { bubbles: true }))
  })()`
  )
  await waitFor(
    client,
    `document.querySelector('.actions-run-pagination > span')?.textContent.includes('50 matching from 50 loaded of 51')`,
    'filtered run page one'
  )
  await clickButton(client, 'Load more runs')
  await waitFor(
    client,
    `document.querySelector('.actions-run-pagination > span')?.textContent.includes('51 matching from 51 loaded of 51')`,
    'filtered run page two'
  )
  await waitFor(
    client,
    `document.body.innerText.includes('Page two sentinel verifies complete workflow run pagination')`,
    'run sentinel'
  )
  await evaluate(
    client,
    `document.querySelector('.actions-run-list').scrollTop = document.querySelector('.actions-run-list').scrollHeight`
  )
  let receipt = await evaluate(client, geometryExpression)
  assertGeometry(receipt)
  const runBytes = await capture(client, runCapture)

  await clickButton(client, 'Refresh')
  await new Promise(resolve => setTimeout(resolve, 750))
  await waitFor(
    client,
    `document.querySelector('.actions-run-pagination > span')?.textContent.includes('51 matching from 51 loaded of 51')`,
    'refreshed retained run pages'
  )
  await waitFor(
    client,
    `document.body.innerText.includes('Page two sentinel verifies complete workflow run pagination')`,
    'refreshed run sentinel'
  )

  await evaluate(
    client,
    `document.querySelector('.actions-run-list').scrollTop = 0`
  )
  await evaluate(
    client,
    `document.querySelector('.actions-run-select').click()`
  )
  await waitFor(
    client,
    `document.querySelector('.actions-artifact-pagination > span')?.textContent.includes('30 loaded of 31')`,
    'artifact page one'
  )
  await evaluate(
    client,
    `document.querySelector('.actions-artifact-pagination').scrollIntoView({ block: 'center' })`
  )
  await clickButton(client, 'Load more artifacts')
  await waitFor(
    client,
    `document.querySelector('.actions-artifact-pagination > span')?.textContent.includes('31 loaded of 31')`,
    'artifact page two'
  )
  await waitFor(
    client,
    `document.body.innerText.includes('page-two-artifact-sentinel')`,
    'artifact sentinel'
  )
  await evaluate(
    client,
    `document.querySelector('.actions-artifact-pagination').scrollIntoView({ block: 'center' })`
  )
  receipt = await evaluate(client, geometryExpression)
  assertGeometry(receipt)
  const artifactBytes = await capture(client, artifactCapture)

  await evaluate(
    client,
    `(() => {
    const headings = [...document.querySelectorAll('.actions-artifact-card h4')]
    const sentinel = headings.find(value => value.textContent.includes('page-two-artifact-sentinel'))
    sentinel.scrollIntoView({ block: 'center', inline: 'nearest' })
  })()`
  )
  const sentinelReceipt = await evaluate(client, geometryExpression)
  assertGeometry(sentinelReceipt)
  const sentinelBytes = await capture(client, sentinelCapture)

  if (
    await evaluate(
      client,
      `[...document.querySelectorAll('button')].some(value => value.textContent.trim() === 'Load more runs' || value.textContent.trim() === 'Load more artifacts')`
    )
  ) {
    fail('A completed pagination control remained visible.')
  }
  return { receipt, sentinelReceipt, runBytes, artifactBytes, sentinelBytes }
}

async function inspect(client, options) {
  const receipt = await evaluate(client, geometryExpression)
  assertGeometry(receipt)
  let captureBytes = null
  if (options.inspectCapture !== undefined) {
    captureBytes = await capture(
      client,
      validateCapturePath(options.inspectCapture, 'capture')
    )
  }
  return { receipt, captureBytes }
}

async function main() {
  const options = parseArguments(process.argv.slice(2))
  const targets = await getJSON(options.port, '/json/list')
  const target = targets.find(
    value => value.type === 'page' && value.webSocketDebuggerUrl
  )
  if (target === undefined) {
    fail('No renderer page target was exposed on the owned CDP port.')
  }
  const client = new CDPClient(target.webSocketDebuggerUrl)
  await client.open()
  try {
    await client.send('Runtime.enable')
    await client.send('Page.enable')
    const result =
      options.mode === 'interact'
        ? await interact(client, options)
        : await inspect(client, options)
    process.stdout.write(
      `${JSON.stringify({ ok: true, mode: options.mode, ...result })}\n`
    )
  } finally {
    client.close()
  }
}

if (require.main === module) {
  main().catch(error => {
    process.stderr.write(
      `${error?.stack || error?.message || String(error ?? 'Unknown error.')}\n`
    )
    process.exitCode = 1
  })
}

module.exports = {
  CDPClient,
  capture,
  clickButton,
  evaluate,
  fail,
  getJSON,
  seedIsolatedProfile,
  validateCapturePath,
  waitFor,
}
