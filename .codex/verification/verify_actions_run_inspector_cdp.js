#!/usr/bin/env node
'use strict'

/**
 * Bounded CDP verifier for the isolated Actions run-inspector production gate.
 * It connects only to the explicitly supplied loopback CDP port and never
 * launches, resizes, focuses, or terminates Electron itself.
 */

const {
  CDPClient,
  capture,
  clickButton,
  evaluate,
  fail,
  getJSON,
  seedIsolatedProfile,
  validateCapturePath,
  waitFor,
} = require('./verify_actions_pagination_cdp.js')

function parseInteger(values, name) {
  const value = Number(values.get(name))
  if (!Number.isSafeInteger(value) || value < 1) {
    fail(`${name} must be a positive integer.`)
  }
  return value
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
  const mode = values.get('mode')
  if (mode !== 'interact' && mode !== 'inspect') {
    fail('mode must be interact or inspect.')
  }
  const target = values.get('target') ?? 'current'
  if (!['current', 'jobs', 'reviews'].includes(target)) {
    fail('target must be current, jobs, or reviews.')
  }
  const options = {
    mode,
    target,
    port: parseInteger(values, 'port'),
    capture: values.get('capture'),
  }
  if (mode === 'inspect') {
    return options
  }

  const endpoint = values.get('provider-endpoint')
  let parsedEndpoint
  try {
    parsedEndpoint = new URL(endpoint)
  } catch {
    fail('provider-endpoint must be a valid URL.')
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
    fail('provider-endpoint must be an uncredentialed loopback /api/v3 URL.')
  }
  const login = values.get('account-login')
  if (!/^[A-Za-z0-9-]{1,39}$/.test(login ?? '')) {
    fail('account-login is invalid.')
  }
  return {
    ...options,
    fixtureAccount: {
      endpoint: parsedEndpoint.toString().replace(/\/$/, ''),
      login,
      id: parseInteger(values, 'account-id'),
    },
    runId: parseInteger(values, 'run-id'),
    currentJobSentinelId: parseInteger(values, 'current-job-sentinel-id'),
    historicalJobSentinelId: parseInteger(values, 'historical-job-sentinel-id'),
    environmentId: parseInteger(values, 'environment-id'),
    jobsCapture: values.get('jobs-capture'),
    reviewsCapture: values.get('reviews-capture'),
    logCapture: values.get('log-capture'),
  }
}

async function clickExpression(client, expression, label) {
  if (!(await evaluate(client, expression))) {
    fail(`Unable to activate ${label}.`)
  }
}

async function changeSelect(client, selector, value) {
  await clickExpression(
    client,
    `(() => {
      const select = document.querySelector(${JSON.stringify(selector)})
      if (!(select instanceof HTMLSelectElement)) return false
      select.value = ${JSON.stringify(String(value))}
      select.dispatchEvent(new Event('change', { bubbles: true }))
      return true
    })()`,
    `${selector}=${value}`
  )
}

async function setTextarea(client, label, value) {
  await clickExpression(
    client,
    `(() => {
      const textarea = [...document.querySelectorAll('textarea')].find(value =>
        value.labels && [...value.labels].some(label =>
          label.textContent.trim() === ${JSON.stringify(label)}
        )
      )
      if (!textarea) return false
      const setter = Object.getOwnPropertyDescriptor(
        HTMLTextAreaElement.prototype, 'value'
      ).set
      setter.call(textarea, ${JSON.stringify(value)})
      textarea.dispatchEvent(new Event('input', { bubbles: true }))
      textarea.dispatchEvent(new Event('change', { bubbles: true }))
      return textarea.value === ${JSON.stringify(value)}
    })()`,
    label
  )
}

async function requireExactCardLink(
  client,
  { containerSelector, pathSuffix, expectedText, query = {}, label }
) {
  const receipt = await evaluate(
    client,
    `(() => {
      const containerSelector = ${JSON.stringify(containerSelector)}
      const pathSuffix = ${JSON.stringify(pathSuffix)}
      const expectedText = ${JSON.stringify(expectedText)}
      const expectedQuery = ${JSON.stringify(query)}
      for (const container of document.querySelectorAll(containerSelector)) {
        if (!container.textContent.includes(expectedText)) continue
        for (const link of container.querySelectorAll('a[href]')) {
          let url
          try { url = new URL(link.href) } catch { continue }
          if (!url.pathname.endsWith(pathSuffix)) continue
          if (Object.entries(expectedQuery).some(
            ([name, value]) => url.searchParams.get(name) !== String(value)
          )) continue
          return { href: link.href, path: url.pathname, query: url.search }
        }
      }
      return null
    })()`
  )
  if (receipt === null) {
    fail(`Unable to prove the exact GitHub identity for ${label}.`)
  }
  return receipt
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
    const identity = element.id ? '#' + element.id :
      (typeof element.className === 'string' && element.className) || element.tagName
    return identity + (text ? ':' + text.slice(0, 100) : '')
  }
  const overflow = []
  for (const selector of [
    '.actions-view', '.actions-content', '.actions-run-column',
    '.actions-run-list', '.actions-run-pagination', '.actions-run-details',
    '.actions-jobs', '.actions-jobs-header', '.actions-attempt-jump',
    '.actions-job-pagination', '#actions-run-job-list', '.actions-job-card',
    '.actions-job-links', '.actions-step-list', '.actions-run-reviews',
    '.actions-pending-environment-grid', '.actions-pending-environment',
    '.actions-deployment-review-actions', '.actions-fork-approval',
    '.actions-review-history', '.actions-dialog-layer',
    '.actions-confirmation-dialog', '.actions-deployment-review-dialog',
    '.actions-log-viewer', '.actions-log-search'
  ]) {
    for (const element of document.querySelectorAll(selector)) {
      if (element.clientWidth > 0 && element.scrollWidth > element.clientWidth + 1) {
        overflow.push({
          element: label(element), client: element.clientWidth,
          scroll: element.scrollWidth, overflowX: getComputedStyle(element).overflowX
        })
      }
    }
  }
  const clipped = []
  for (const element of document.querySelectorAll([
    '.actions-run-summary > strong', '.branch-chip', '.actions-actor',
    '.actions-run-pagination > span', '.actions-details-header h2',
    '.actions-jobs-header h3', '.actions-attempt-guidance',
    '.actions-attempt-jump label', '.actions-job-pagination > span',
    '.actions-job-pagination > small', '.actions-job-card strong',
    '.actions-job-links button', '.actions-step-list span',
    '.actions-run-reviews h3', '.actions-pending-environment strong',
    '.actions-pending-environment small', '.actions-pending-environment-meta',
    '.actions-pending-reviewers .link-button-component',
    '.actions-deployment-review-actions span', '.actions-fork-approval span',
    '.actions-review-history li', '.actions-dialog-layer h2',
    '.actions-dialog-layer button', '.actions-dialog-layer label',
    '.actions-dialog-layer small', '.actions-log-viewer h2'
  ].join(','))) {
    if (visible(element) && (element.scrollWidth > element.clientWidth + 1 ||
      element.scrollHeight > element.clientHeight + 1)) {
      clipped.push({
        element: label(element), clientWidth: element.clientWidth,
        scrollWidth: element.scrollWidth, clientHeight: element.clientHeight,
        scrollHeight: element.scrollHeight
      })
    }
  }
  const outside = []
  for (const element of document.querySelectorAll([
    '.actions-view button', '.actions-view input', '.actions-view select',
    '.actions-view textarea', '.actions-view h1', '.actions-view h2',
    '.actions-view h3', '.actions-dialog-layer button',
    '.actions-dialog-layer input', '.actions-dialog-layer textarea',
    '.actions-dialog-layer h2'
  ].join(','))) {
    if (!visible(element)) continue
    const rect = element.getBoundingClientRect()
    const modalOwned = element.closest('[aria-modal="true"]') !== null
    if (rect.left < -1 || rect.right > innerWidth + 1 ||
        (modalOwned && (rect.top < -1 || rect.bottom > innerHeight + 1))) {
      outside.push({
        element: label(element), left: one(rect.left), right: one(rect.right),
        top: one(rect.top), bottom: one(rect.bottom)
      })
    }
  }
  const overlaps = []
  for (const container of document.querySelectorAll([
    '.actions-run-pagination', '.actions-jobs-header',
    '.actions-attempt-jump', '.actions-job-pagination',
    '.actions-job-links', '.actions-deployment-review-actions > div',
    '.actions-fork-approval', '.actions-dialog-layer footer',
    '.actions-log-search'
  ].join(','))) {
    const children = [...container.children].filter(visible)
    for (let left = 0; left < children.length; left++) {
      for (let right = left + 1; right < children.length; right++) {
        const a = children[left].getBoundingClientRect()
        const b = children[right].getBoundingClientRect()
        const width = Math.min(a.right, b.right) - Math.max(a.left, b.left)
        const height = Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top)
        if (width > 1 && height > 1) {
          overlaps.push({
            container: label(container), left: label(children[left]),
            right: label(children[right]), width: one(width), height: one(height)
          })
        }
      }
    }
  }
  const oversized = []
  for (const element of document.querySelectorAll('.actions-view h1, .actions-view h2, .actions-view h3, .actions-dialog-layer h2')) {
    if (visible(element) && parseFloat(getComputedStyle(element).fontSize) > 36) {
      oversized.push({ element: label(element), fontSize: getComputedStyle(element).fontSize })
    }
  }
  const modals = [...document.querySelectorAll('[aria-modal="true"]')].filter(visible)
  const layers = [...document.querySelectorAll('.actions-dialog-layer')].filter(visible)
  return {
    innerWidth, innerHeight, devicePixelRatio,
    documentClientWidth: document.documentElement.clientWidth,
    documentScrollWidth: document.documentElement.scrollWidth,
    bodyClientWidth: document.body.clientWidth,
    bodyScrollWidth: document.body.scrollWidth,
    selectedAttempt: document.querySelector('select[name="actions-run-attempt"]')?.value || null,
    jobCountText: document.querySelector('.actions-job-pagination > span')?.textContent.trim() || null,
    pendingCountText: document.querySelector('.actions-deployment-review-actions > span')?.textContent.trim() || null,
    currentSentinel: document.body.innerText.includes('Page-two current-attempt Windows packaging sentinel'),
    historicalSentinel: document.body.innerText.includes('Page-two historical-attempt Linux timeout sentinel'),
    modalCount: modals.length,
    layerCount: layers.length,
    modalFocusContained: modals.length === 0 || modals.some(value => value.contains(document.activeElement)),
    layerPointerEvents: layers.map(value => getComputedStyle(value).pointerEvents),
    overflow, clipped, outside, overlaps, oversized
  }
})()`

function assertGeometry(receipt, { modal = false } = {}) {
  const failures = []
  if (receipt.documentScrollWidth !== receipt.documentClientWidth) {
    failures.push('document width')
  }
  if (receipt.bodyScrollWidth !== receipt.bodyClientWidth) {
    failures.push('body width')
  }
  for (const key of [
    'overflow',
    'clipped',
    'outside',
    'overlaps',
    'oversized',
  ]) {
    if (receipt[key].length > 0) failures.push(key)
  }
  if (modal) {
    if (receipt.modalCount !== 1 || receipt.layerCount !== 1) {
      failures.push('single modal layer')
    }
    if (!receipt.modalFocusContained) failures.push('modal focus')
    if (receipt.layerPointerEvents.some(value => value === 'none')) {
      failures.push('modal pointer boundary')
    }
  } else if (receipt.modalCount !== 0 || receipt.layerCount !== 0) {
    failures.push('unexpected modal')
  }
  if (failures.length > 0) {
    fail(
      `Geometry gate failed (${failures.join(', ')}): ${JSON.stringify(
        receipt
      )}`
    )
  }
}

async function openActions(client, fixtureAccount) {
  if (await seedIsolatedProfile(client, fixtureAccount)) {
    fail(
      'Initialized the isolated verification profile; restart the exact app with the same profile before retrying.'
    )
  }
  await waitFor(
    client,
    `document.querySelector('#actions-tab') !== null || [...document.querySelectorAll('button')].some(value => (value.textContent.trim() === 'Add repository' || value.textContent.trim().startsWith('Fetch origin')) && !value.disabled)`,
    'app shell or repository confirmation'
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
    await clickExpression(
      client,
      `(() => {
        const button = [...document.querySelectorAll('button')].find(value =>
          value.textContent.trim().startsWith('Fetch origin') && !value.disabled
        )
        if (!button) return false
        button.click()
        return true
      })()`,
      'Fetch origin'
    )
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
}

async function interact(client, options) {
  const jobsCapture = validateCapturePath(options.jobsCapture, 'jobs-capture')
  const reviewsCapture = validateCapturePath(
    options.reviewsCapture,
    'reviews-capture'
  )
  const logCapture = validateCapturePath(options.logCapture, 'log-capture')
  await openActions(client, options.fixtureAccount)

  await waitFor(
    client,
    `document.querySelector('.actions-run-pagination > span')?.textContent.includes('50 loaded of 52')`,
    'workflow run page one'
  )
  await clickButton(client, 'Load more runs')
  await waitFor(
    client,
    `document.querySelector('.actions-run-pagination > span')?.textContent.includes('52 loaded of 52')`,
    'workflow run page two'
  )
  const runLink = await requireExactCardLink(client, {
    containerSelector: '.actions-run-card',
    pathSuffix: `/actions/runs/${options.runId}`,
    expectedText: 'Actions run inspector verifies attempt navigation',
    label: `inspector run ${options.runId}`,
  })
  await clickExpression(
    client,
    `(() => {
      const card = [...document.querySelectorAll('.actions-run-card')].find(value =>
        value.textContent.includes('Actions run inspector verifies attempt navigation')
      )
      const button = card?.querySelector('.actions-run-select')
      if (!button) return false
      button.click()
      return true
    })()`,
    `inspector run ${options.runId}`
  )
  await waitFor(
    client,
    `document.querySelector('.actions-job-pagination > span')?.textContent.includes('50 loaded of 51 jobs for attempt 2')`,
    'current attempt job page one'
  )
  await clickButton(client, 'Load more jobs')
  await waitFor(
    client,
    `document.querySelector('.actions-job-error')?.textContent.includes('503') && document.querySelectorAll('.actions-job-card').length === 50`,
    'retained job page after one-shot failure'
  )
  await clickButton(client, 'Load more jobs')
  await waitFor(
    client,
    `document.querySelector('.actions-job-pagination > span')?.textContent.includes('51 loaded of 51 jobs for attempt 2') && document.body.innerText.includes('Page-two current-attempt Windows packaging sentinel')`,
    'recovered page-two current job sentinel'
  )
  const currentJobLink = await requireExactCardLink(client, {
    containerSelector: '.actions-job-card',
    pathSuffix: `/actions/runs/${options.runId}/job/${options.currentJobSentinelId}`,
    expectedText: 'Page-two current-attempt Windows packaging sentinel',
    label: `current-attempt job ${options.currentJobSentinelId}`,
  })
  await evaluate(
    client,
    `(() => {
      const sentinel = [...document.querySelectorAll('.actions-job-card')].find(value =>
        value.textContent.includes('Page-two current-attempt Windows packaging sentinel')
      )
      sentinel?.scrollIntoView({ block: 'center', inline: 'nearest' })
    })()`
  )
  const jobsReceipt = await evaluate(client, geometryExpression)
  assertGeometry(jobsReceipt)
  const jobsBytes = await capture(client, jobsCapture)

  await clickExpression(
    client,
    `(() => {
      const card = [...document.querySelectorAll('.actions-job-card')].find(value =>
        value.textContent.includes('Page-two current-attempt Windows packaging sentinel')
      )
      const button = [...(card?.querySelectorAll('button') || [])].find(value =>
        value.textContent.trim() === 'View logs'
      )
      if (!button) return false
      button.click()
      return true
    })()`,
    `logs for job ${options.currentJobSentinelId}`
  )
  await waitFor(
    client,
    `document.querySelector('.actions-log-viewer')?.textContent.includes('Exact workflow job ${options.currentJobSentinelId}')`,
    'exact page-two job log'
  )
  const logReceipt = await evaluate(client, geometryExpression)
  assertGeometry(logReceipt, { modal: true })
  const logBytes = await capture(client, logCapture)
  await clickExpression(
    client,
    `(() => {
      const button = [...document.querySelectorAll('.actions-log-viewer button')].find(value =>
        value.textContent.trim() === 'Close'
      )
      if (!button) return false
      button.click()
      return true
    })()`,
    'Close job log'
  )
  await waitFor(
    client,
    `document.querySelector('.actions-log-viewer') === null`,
    'closed job log'
  )

  await clickExpression(
    client,
    `(() => {
      const card = [...document.querySelectorAll('.actions-job-card')].find(value =>
        value.textContent.includes('Page-two current-attempt Windows packaging sentinel')
      )
      const button = [...(card?.querySelectorAll('button') || [])].find(value =>
        value.textContent.trim() === 'Re-run job'
      )
      if (!button) return false
      button.click()
      return true
    })()`,
    `re-run job ${options.currentJobSentinelId}`
  )
  await waitFor(
    client,
    `document.querySelector('.actions-banner.success')?.textContent.includes('Re-run requested')`,
    'exact job re-run receipt'
  )

  await changeSelect(client, 'select[name="actions-run-attempt"]', 1)
  await waitFor(
    client,
    `document.querySelector('.actions-job-pagination > span')?.textContent.includes('50 loaded of 51 jobs for attempt 1')`,
    'historical attempt page one'
  )
  await clickButton(client, 'Load more jobs')
  await waitFor(
    client,
    `document.querySelector('.actions-job-pagination > span')?.textContent.includes('51 loaded of 51 jobs for attempt 1') && document.body.innerText.includes('Page-two historical-attempt Linux timeout sentinel')`,
    'historical page-two sentinel'
  )
  const historicalJobLink = await requireExactCardLink(client, {
    containerSelector: '.actions-job-card',
    pathSuffix: `/actions/runs/${options.runId}/job/${options.historicalJobSentinelId}`,
    expectedText: 'Page-two historical-attempt Linux timeout sentinel',
    label: `historical-attempt job ${options.historicalJobSentinelId}`,
  })

  await evaluate(
    client,
    `document.querySelector('.actions-run-reviews')?.scrollIntoView({ block: 'start', inline: 'nearest' })`
  )
  await waitFor(
    client,
    `document.querySelectorAll('.actions-pending-environment').length === 2 && document.body.innerText.includes('Locked deployment environment')`,
    'pending deployment environments'
  )
  const environmentLink = await requireExactCardLink(client, {
    containerSelector: '.actions-pending-environment',
    pathSuffix: '/deployments/activity_log',
    expectedText:
      'Production environment with an intentionally long responsive name',
    query: { environment: options.environmentId },
    label: `pending environment ${options.environmentId}`,
  })
  const reviewsReceipt = await evaluate(client, geometryExpression)
  assertGeometry(reviewsReceipt)
  const reviewsBytes = await capture(client, reviewsCapture)

  await clickExpression(
    client,
    `(() => {
      const label = [...document.querySelectorAll('.actions-pending-environment label')].find(value =>
        value.textContent.includes('Production environment with an intentionally long responsive name')
      )
      const checkbox = label?.querySelector('input[type="checkbox"]')
      if (!checkbox || checkbox.disabled) return false
      checkbox.click()
      return true
    })()`,
    `environment ${options.environmentId}`
  )
  await waitFor(
    client,
    `[...document.querySelectorAll('button')].some(value => value.textContent.trim() === 'Approve selected' && !value.disabled)`,
    'enabled Approve selected action'
  )
  await clickButton(client, 'Approve selected')
  await waitFor(
    client,
    `document.querySelector('.actions-deployment-review-dialog') !== null`,
    'deployment review dialog'
  )
  const reviewComment =
    'Approved after inspecting the exact recovered page-two job log and responsive geometry.'
  await setTextarea(client, 'Review comment', reviewComment)
  const deploymentDialogReceipt = await evaluate(client, geometryExpression)
  assertGeometry(deploymentDialogReceipt, { modal: true })
  await clickButton(client, 'Approve deployments')
  await waitFor(
    client,
    `document.body.innerText.includes('Selected deployments approved.') && document.querySelectorAll('.actions-pending-environment').length === 1`,
    'approved deployment state'
  )

  await clickButton(client, 'Review fork approval')
  await waitFor(
    client,
    `document.querySelector('.actions-confirmation-dialog')?.textContent.includes('Approve fork workflow run?')`,
    'fork approval dialog'
  )
  const forkDialogReceipt = await evaluate(client, geometryExpression)
  assertGeometry(forkDialogReceipt, { modal: true })
  await clickButton(client, 'Approve fork run')
  await waitFor(
    client,
    `document.body.innerText.includes('Fork workflow run approved.') && !document.body.innerText.includes('Review fork approval')`,
    'approved fork run state'
  )

  const finalReceipt = await evaluate(client, geometryExpression)
  assertGeometry(finalReceipt)
  return {
    runId: options.runId,
    currentJobSentinelId: options.currentJobSentinelId,
    historicalJobSentinelId: options.historicalJobSentinelId,
    environmentId: options.environmentId,
    reviewComment,
    exactLinks: {
      run: runLink,
      currentJob: currentJobLink,
      historicalJob: historicalJobLink,
      environment: environmentLink,
    },
    jobsReceipt,
    logReceipt,
    reviewsReceipt,
    deploymentDialogReceipt,
    forkDialogReceipt,
    finalReceipt,
    jobsBytes,
    reviewsBytes,
    logBytes,
  }
}

async function inspect(client, options) {
  if (options.target !== 'current') {
    await evaluate(
      client,
      options.target === 'jobs'
        ? `document.querySelector('.actions-job-card:last-child')?.scrollIntoView({ block: 'center', inline: 'nearest' })`
        : `document.querySelector('.actions-run-reviews')?.scrollIntoView({ block: 'start', inline: 'nearest' })`
    )
  }
  const receipt = await evaluate(client, geometryExpression)
  assertGeometry(receipt, { modal: receipt.modalCount > 0 })
  const captureBytes =
    options.capture === undefined
      ? null
      : await capture(client, validateCapturePath(options.capture, 'capture'))
  return { target: options.target, receipt, captureBytes }
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

main().catch(error => {
  process.stderr.write(
    `${error?.stack || error?.message || String(error ?? 'Unknown error.')}\n`
  )
  process.exitCode = 1
})
