#!/usr/bin/env node
/* eslint-disable no-sync -- bounded verification paths are validated before synchronous probes */

/**
 * Bounded CDP verifier for notification bulk actions and non-modal error
 * notices. The caller owns Electron, the loopback port, the hidden desktop,
 * captures, and cleanup. This helper never launches or terminates the app.
 */

const fs = require('fs')
const path = require('path')
const { chromium } = require('playwright')

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
  if (mode !== 'seed' && mode !== 'capture') {
    fail('Mode must be seed or capture.')
  }

  if (mode === 'seed') {
    return { port, mode }
  }

  const runRoot = path.resolve(values.get('run-root') ?? '')
  if (!path.basename(runRoot).startsWith('desktop-material-p0-ui-')) {
    fail('The owned run root is invalid.')
  }

  const capture = name => {
    const value = values.get(name)
    if (value === undefined) {
      fail(`${name} is required.`)
    }
    const resolved = path.resolve(value)
    const relative = path.relative(runRoot, resolved)
    if (
      relative.startsWith('..') ||
      path.isAbsolute(relative) ||
      fs.existsSync(resolved)
    ) {
      fail(`${name} must be a new file inside the owned run root.`)
    }
    if (!fs.statSync(path.dirname(resolved)).isDirectory()) {
      fail(`${name} parent does not exist.`)
    }
    return resolved
  }

  return {
    port,
    mode,
    noticeCapture: capture('notice-capture'),
    bulkCapture: capture('bulk-capture'),
  }
}

async function connect(port) {
  const deadline = Date.now() + 20_000
  let lastError = null
  while (Date.now() < deadline) {
    try {
      return await chromium.connectOverCDP(`http://127.0.0.1:${port}`)
    } catch (error) {
      lastError = error
      await new Promise(resolve => setTimeout(resolve, 200))
    }
  }
  throw lastError ?? new Error('Timed out connecting to the renderer.')
}

async function getRenderer(browser) {
  const deadline = Date.now() + 20_000
  while (Date.now() < deadline) {
    const pages = browser.contexts().flatMap(context => context.pages())
    const page = pages.find(candidate =>
      candidate.url().includes('/out/index.html')
    )
    if (page !== undefined) {
      return page
    }
    await new Promise(resolve => setTimeout(resolve, 100))
  }
  fail('The isolated Desktop Material renderer target was not found.')
}

async function seedProfile(page) {
  return page.evaluate(() => {
    const expected = {
      'has-shown-welcome-flow': '1',
      theme: 'light',
      'zoom-auto-fit-enabled': '1',
      'stats-opt-out': '1',
      'has-sent-stats-opt-in-ping': '1',
      'error-presentation-style': 'notice',
    }
    let changed = false
    for (const [key, value] of Object.entries(expected)) {
      if (localStorage.getItem(key) !== value) {
        localStorage.setItem(key, value)
        changed = true
      }
    }
    return changed
  })
}

async function prepareApp(page) {
  await page.locator('#desktop-app-contents').waitFor({
    state: 'visible',
    timeout: 30_000,
  })

  const addRepository = page.getByRole('button', {
    name: 'Add repository',
    exact: true,
  })
  if (await addRepository.isVisible()) {
    await addRepository.click()
  }

  await page
    .getByRole('button', {
      name: /^Notifications(?: \(\d+ unread\))?$/,
    })
    .waitFor({ state: 'visible', timeout: 30_000 })
}

async function clearExistingLocalNotifications(page) {
  const panel = page.getByRole('dialog', {
    name: 'Notifications',
    exact: true,
  })
  if (!(await panel.isVisible())) {
    await page
      .getByRole('button', {
        name: /^Notifications(?: \(\d+ unread\))?$/,
      })
      .click()
  }
  await panel.waitFor({ state: 'visible', timeout: 15_000 })

  const clear = panel
    .getByRole('button', { name: 'Clear all', exact: true })
    .first()
  if (await clear.isEnabled()) {
    await clear.click()
    const confirmation = panel.getByRole('alertdialog', {
      name: 'Clear every Local notification?',
    })
    await confirmation.waitFor({ state: 'visible' })
    await confirmation
      .getByRole('button', { name: 'Clear all', exact: true })
      .click()
    await panel
      .getByText("You're all caught up", { exact: true })
      .waitFor({ state: 'visible', timeout: 20_000 })
  }

  await panel
    .getByRole('button', { name: 'Close notifications', exact: true })
    .click()
  await panel.waitFor({ state: 'detached', timeout: 15_000 })
}

async function triggerTestError(page, suffix) {
  const before = await page.locator('.error-notice').count()
  await page.evaluate(value => {
    process.env.GITHUB_DESKTOP_PREVIEW_FEATURES = '1'
    const cryptoObject = globalThis.crypto
    const existing = Object.getOwnPropertyDescriptor(cryptoObject, 'randomUUID')
    Object.defineProperty(cryptoObject, 'randomUUID', {
      configurable: true,
      value: () => value,
    })
    try {
      require('electron').ipcRenderer.emit('menu-event', {}, 'test-app-error')
    } finally {
      if (existing === undefined) {
        delete cryptoObject.randomUUID
      } else {
        Object.defineProperty(cryptoObject, 'randomUUID', existing)
      }
    }
  }, suffix)

  await page.waitForFunction(
    count => document.querySelectorAll('.error-notice').length > count,
    before,
    { timeout: 15_000 }
  )
}

async function inspectNotice(page) {
  return page.evaluate(() => {
    const stack = document.querySelector('.error-notice-stack')
    if (!(stack instanceof HTMLElement)) {
      throw new Error('The error notice stack is missing.')
    }
    const notices = [...stack.querySelectorAll('.error-notice')]
    const stackRect = stack.getBoundingClientRect()
    const rect = element => {
      const value = element.getBoundingClientRect()
      return {
        left: Math.round(value.left),
        top: Math.round(value.top),
        right: Math.round(value.right),
        bottom: Math.round(value.bottom),
      }
    }
    const withinViewport = value =>
      value.left >= -1 &&
      value.top >= -1 &&
      value.right <= innerWidth + 1 &&
      value.bottom <= innerHeight + 1

    return {
      viewport: { width: innerWidth, height: innerHeight },
      document: {
        clientWidth: document.documentElement.clientWidth,
        scrollWidth: document.documentElement.scrollWidth,
        bodyClientWidth: document.body.clientWidth,
        bodyScrollWidth: document.body.scrollWidth,
      },
      stack: {
        ...rect(stack),
        position: getComputedStyle(stack).position,
        withinViewport: withinViewport(stackRect),
      },
      notices: notices.map(notice => {
        const noticeRect = notice.getBoundingClientRect()
        return {
          ...rect(notice),
          withinViewport: withinViewport(noticeRect),
          clientWidth: notice.clientWidth,
          scrollWidth: notice.scrollWidth,
          text: notice.textContent?.replace(/\s+/g, ' ').trim(),
        }
      }),
      dismissButtons: [...stack.querySelectorAll('button')].map(button =>
        button.getAttribute('aria-label')
      ),
    }
  })
}

async function waitForResponsiveLayout(page) {
  await page.waitForTimeout(1_200)
  await page.locator('#window-zoom-info').waitFor({
    state: 'detached',
    timeout: 5_000,
  })
}

function assertNotice(receipt, label) {
  if (
    receipt.document.clientWidth !== receipt.document.scrollWidth ||
    receipt.document.bodyClientWidth !== receipt.document.bodyScrollWidth ||
    receipt.stack.position !== 'fixed' ||
    !receipt.stack.withinViewport ||
    receipt.notices.length !== 1 ||
    receipt.notices.some(
      notice =>
        !notice.withinViewport || notice.scrollWidth > notice.clientWidth + 1
    ) ||
    !receipt.notices[0].text?.includes('bottom-right notice') ||
    receipt.dismissButtons.some(name => !name?.startsWith('Dismiss Error'))
  ) {
    fail(`${label} error notice gate failed: ${JSON.stringify(receipt)}`)
  }
}

async function dismissAllNotices(page) {
  while (true) {
    const before = await page.locator('.error-notice').count()
    if (before === 0) {
      return
    }
    const clicked = await page.evaluate(() => {
      const buttons = [...document.querySelectorAll('.error-notice-dismiss')]
      const button = buttons.at(-1)
      if (!(button instanceof HTMLButtonElement)) {
        return false
      }
      button.click()
      return true
    })
    if (!clicked) {
      fail('A current error notice could not be dismissed.')
    }
    await page.waitForFunction(
      count => document.querySelectorAll('.error-notice').length < count,
      before,
      { timeout: 15_000 }
    )
  }
}

async function openBulkState(page) {
  await page
    .getByRole('button', {
      name: /^Notifications(?: \(\d+ unread\))?$/,
    })
    .click()

  const panel = page.getByRole('dialog', {
    name: 'Notifications',
    exact: true,
  })
  await panel.waitFor({ state: 'visible', timeout: 15_000 })
  await panel
    .getByRole('combobox', { name: 'Local notification type' })
    .selectOption('app-error')
  await panel
    .getByRole('searchbox', { name: 'Search local notifications' })
    .fill('bulk action')

  const rows = panel.locator('.notification-item')
  await page.waitForFunction(
    () =>
      document.querySelectorAll('.notification-centre-panel .notification-item')
        .length === 3,
    undefined,
    { timeout: 20_000 }
  )
  if ((await rows.count()) !== 3) {
    fail('The exact filtered bulk-action fixture did not load.')
  }

  await rows.first().getByRole('button', { name: 'Mark as read' }).click()
  await rows
    .first()
    .getByRole('button', { name: 'Mark as unread' })
    .waitFor({ state: 'visible', timeout: 15_000 })

  await panel
    .getByRole('checkbox', { name: 'Select all visible notifications' })
    .check()
  await panel.getByText('3 selected', { exact: true }).waitFor()

  for (const name of [
    'Mark read',
    'Mark unread',
    'Delete selected',
    'Clear all',
  ]) {
    const button = panel.getByRole('button', { name, exact: true })
    if (!(await button.isEnabled())) {
      fail(`${name} was not enabled in the mixed-read bulk selection.`)
    }
  }

  await panel.getByRole('button', { name: 'Clear all', exact: true }).click()
  const confirmation = panel.getByRole('alertdialog', {
    name: 'Clear every Local notification?',
  })
  await confirmation.waitFor({ state: 'visible' })
  if (
    !(await confirmation.textContent())?.includes(
      'Notification history can restore them later.'
    )
  ) {
    fail('The Clear all confirmation did not explain history recovery.')
  }

  return panel
}

async function assertControlsReachable(panel) {
  const controls = [
    panel.getByRole('tab', { name: 'Local', exact: true }),
    panel.getByRole('tab', { name: 'GitHub', exact: true }),
    panel.getByRole('searchbox', { name: 'Search local notifications' }),
    panel.getByRole('combobox', { name: 'Local notification type' }),
    panel.getByRole('checkbox', {
      name: 'Select all visible notifications',
    }),
    panel.getByRole('button', { name: 'Mark read', exact: true }),
    panel.getByRole('button', { name: 'Mark unread', exact: true }),
    panel.getByRole('button', { name: 'Delete selected', exact: true }),
    panel.getByRole('button', { name: 'Clear all', exact: true }).first(),
    panel.getByRole('button', { name: 'Cancel', exact: true }),
  ]

  for (const control of controls) {
    await control.scrollIntoViewIfNeeded()
    if (!(await control.isVisible())) {
      fail(`A required notification control is unreachable.`)
    }
  }
}

async function inspectPanel(page) {
  return page.evaluate(() => {
    const panel = document.querySelector('.notification-centre-panel')
    const source = document.querySelector('.notification-centre-source-panel')
    const list = document.querySelector('.notification-centre-list')
    if (!(panel instanceof HTMLElement) || !(source instanceof HTMLElement)) {
      throw new Error('Notification panel geometry is unavailable.')
    }
    const panelRect = panel.getBoundingClientRect()
    const visibleControls = [
      ...panel.querySelectorAll('button, input, select, [role="tab"]'),
    ].filter(element => {
      const rect = element.getBoundingClientRect()
      const style = getComputedStyle(element)
      return (
        style.display !== 'none' &&
        style.visibility !== 'hidden' &&
        rect.width > 0 &&
        rect.height > 0 &&
        rect.bottom > 0 &&
        rect.top < innerHeight
      )
    })

    return {
      viewport: { width: innerWidth, height: innerHeight },
      document: {
        clientWidth: document.documentElement.clientWidth,
        scrollWidth: document.documentElement.scrollWidth,
        bodyClientWidth: document.body.clientWidth,
        bodyScrollWidth: document.body.scrollWidth,
      },
      panel: {
        left: Math.round(panelRect.left),
        top: Math.round(panelRect.top),
        right: Math.round(panelRect.right),
        bottom: Math.round(panelRect.bottom),
        clientWidth: panel.clientWidth,
        scrollWidth: panel.scrollWidth,
        withinViewport:
          panelRect.left >= -1 &&
          panelRect.top >= -1 &&
          panelRect.right <= innerWidth + 1 &&
          panelRect.bottom <= innerHeight + 1,
      },
      source: {
        clientWidth: source.clientWidth,
        scrollWidth: source.scrollWidth,
        clientHeight: source.clientHeight,
        scrollHeight: source.scrollHeight,
        overflowY: getComputedStyle(source).overflowY,
      },
      list:
        list instanceof HTMLElement
          ? {
              clientWidth: list.clientWidth,
              scrollWidth: list.scrollWidth,
              itemCount: list.querySelectorAll('.notification-item').length,
            }
          : null,
      selected: panel.querySelector('.notification-centre-selected-count')
        ?.textContent,
      confirmation: panel.querySelector(
        '#notification-centre-clear-description'
      )?.textContent,
      unnamedControls: visibleControls
        .filter(element => {
          const text = element.textContent?.trim()
          return !(
            element.getAttribute('aria-label') ||
            element.getAttribute('aria-labelledby') ||
            text
          )
        })
        .map(element => element.outerHTML.slice(0, 160)),
    }
  })
}

function assertPanel(receipt, label, requireScrollableSource) {
  if (
    receipt.document.clientWidth !== receipt.document.scrollWidth ||
    receipt.document.bodyClientWidth !== receipt.document.bodyScrollWidth ||
    !receipt.panel.withinViewport ||
    receipt.panel.scrollWidth > receipt.panel.clientWidth + 1 ||
    receipt.source.scrollWidth > receipt.source.clientWidth + 1 ||
    (receipt.list !== null &&
      receipt.list.scrollWidth > receipt.list.clientWidth + 1) ||
    receipt.list?.itemCount !== 3 ||
    receipt.selected?.trim() !== '3 selected' ||
    !receipt.confirmation?.includes(
      'Notification history can restore them later.'
    ) ||
    receipt.unnamedControls.length > 0 ||
    (requireScrollableSource &&
      receipt.source.scrollHeight > receipt.source.clientHeight &&
      !['auto', 'scroll'].includes(receipt.source.overflowY))
  ) {
    fail(`${label} notification panel gate failed: ${JSON.stringify(receipt)}`)
  }
}

async function runCapture(page, options) {
  await prepareApp(page)
  await clearExistingLocalNotifications(page)

  await triggerTestError(page, ' — bottom-right notice')
  const notice = await inspectNotice(page)
  assertNotice(notice, 'Normal-height')
  await page.screenshot({ path: options.noticeCapture })

  const session = await page.context().newCDPSession(page)
  await session.send('Emulation.setDeviceMetricsOverride', {
    width: 640,
    height: 480,
    deviceScaleFactor: 1,
    mobile: false,
    screenWidth: 640,
    screenHeight: 480,
  })
  await waitForResponsiveLayout(page)
  const compactNotice = await inspectNotice(page)
  assertNotice(compactNotice, 'Short-height')
  await session.send('Emulation.clearDeviceMetricsOverride')

  await dismissAllNotices(page)
  for (const suffix of [
    ' — bulk action one',
    ' — bulk action two',
    ' — bulk action three',
  ]) {
    await triggerTestError(page, suffix)
  }
  await dismissAllNotices(page)

  const panel = await openBulkState(page)
  await assertControlsReachable(panel)
  const normalPanel = await inspectPanel(page)
  assertPanel(normalPanel, 'Normal-height', false)

  await session.send('Emulation.setDeviceMetricsOverride', {
    width: 960,
    height: 560,
    deviceScaleFactor: 1,
    mobile: false,
    screenWidth: 960,
    screenHeight: 560,
  })
  await waitForResponsiveLayout(page)
  await assertControlsReachable(panel)
  await page.evaluate(() => {
    const source = document.querySelector('.notification-centre-source-panel')
    if (source instanceof HTMLElement) {
      source.scrollTop = 0
    }
  })
  await page.waitForTimeout(250)
  const compactPanel = await inspectPanel(page)
  assertPanel(compactPanel, 'Short-height', true)
  await page.screenshot({ path: options.bulkCapture })
  await session.send('Emulation.clearDeviceMetricsOverride')
  await page.evaluate(() => {
    delete process.env.GITHUB_DESKTOP_PREVIEW_FEATURES
  })

  return { notice, compactNotice, normalPanel, compactPanel }
}

async function main() {
  const options = parseArguments(process.argv.slice(2))
  const browser = await connect(options.port)
  const page = await getRenderer(browser)

  if (options.mode === 'seed') {
    const changed = await seedProfile(page)
    process.stdout.write(`${JSON.stringify({ changed })}\n`)
    process.exit(0)
  }

  const receipt = await runCapture(page, options)
  process.stdout.write(`${JSON.stringify(receipt)}\n`)
  process.exit(0)
}

main().catch(error => {
  process.stderr.write(`${error.stack ?? error}\n`)
  process.exit(1)
})
