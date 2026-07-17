#!/usr/bin/env node
'use strict'

/*
 * Isolated renderer verifier for navigation search/filtering, button hints,
 * History contextual actions, repository-list scopes, and the Repository
 * Tools owned scroll region. The caller owns Electron, the loopback port,
 * hidden desktop, capture paths, and cleanup. This helper never launches,
 * focuses, resizes, or terminates a native window.
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
  if (!Number.isSafeInteger(port) || port < 1 || port > 65535) {
    fail('A valid loopback CDP port is required.')
  }

  const runRoot = path.resolve(values.get('run-root') ?? '')
  if (!path.basename(runRoot).startsWith('desktop-material-p0-ui-')) {
    fail('The owned run root is invalid.')
  }
  if (!fs.statSync(runRoot).isDirectory()) {
    fail('The owned run root does not exist.')
  }
  const repositoryPath = path.join(runRoot, 'git-source')
  if (
    !fs.statSync(repositoryPath).isDirectory() ||
    !fs.statSync(path.join(repositoryPath, '.git')).isDirectory()
  ) {
    fail('The deterministic repository fixture is missing.')
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
    runRoot,
    repositoryPath,
    tabsCapture: capture('tabs-capture'),
    historyCapture: capture('history-capture'),
    toolsCapture: capture('tools-capture'),
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
    const page = browser
      .contexts()
      .flatMap(context => context.pages())
      .find(candidate => candidate.url().includes('/out/index.html'))
    if (page !== undefined) {
      return page
    }
    await new Promise(resolve => setTimeout(resolve, 100))
  }
  fail('The isolated Desktop Material renderer target was not found.')
}

async function settle(page) {
  await page.waitForTimeout(500)
  await page.locator('#window-zoom-info').waitFor({
    state: 'detached',
    timeout: 5_000,
  })
}

async function prepareApp(page, repositoryPath) {
  await page.locator('#desktop-app-contents').waitFor({
    state: 'visible',
    timeout: 30_000,
  })

  const changed = await page.evaluate(() => {
    const expected = {
      'has-shown-welcome-flow': '1',
      theme: 'light',
      'zoom-auto-fit-enabled': '0',
      'stats-opt-out': '1',
      'has-sent-stats-opt-in-ping': '1',
    }
    let didChange = false
    for (const [key, value] of Object.entries(expected)) {
      if (localStorage.getItem(key) !== value) {
        localStorage.setItem(key, value)
        didChange = true
      }
    }
    return didChange
  })
  if (changed) {
    await page.reload({ waitUntil: 'domcontentloaded' })
    await page.locator('#desktop-app-contents').waitFor({
      state: 'visible',
      timeout: 30_000,
    })
  }

  const continueWithoutAccount = page.getByRole('link', {
    name: 'Continue without signing in',
    exact: true,
  })
  if (await continueWithoutAccount.isVisible()) {
    await continueWithoutAccount.click()
  }

  for (const selector of [
    '.tab-search-popover',
    '.arrange-tabs',
    '#app-menu-foldout',
  ]) {
    const surface = page.locator(selector)
    if (await surface.isVisible()) {
      await page.keyboard.press('Escape')
      await surface.waitFor({ state: 'detached' })
    }
  }

  const targetName = path.basename(repositoryPath)
  const repositoryDropdown = page.locator('.toolbar-dropdown.foldout-style', {
    has: page.locator('.description', { hasText: 'Current repository' }),
  })
  const currentRepositoryTitle = repositoryDropdown.locator('.title')
  const history = page.getByRole('tab', { name: 'History', exact: true })
  const addLocalHeading = page.getByRole('heading', {
    name: 'Add local repository',
    exact: true,
  })
  await page.waitForTimeout(500)
  if (
    (await currentRepositoryTitle.textContent().catch(() => null))?.trim() !==
    targetName
  ) {
    await repositoryDropdown.locator('.toolbar-button > button').click()
    const repositoryList = page.locator('.repository-list')
    await repositoryList.waitFor({ state: 'visible', timeout: 10_000 })
    const targetOption = repositoryList
      .getByRole('option')
      .filter({ hasText: targetName })
      .first()
    if ((await targetOption.count()) > 0) {
      await targetOption.click()
      await repositoryList.waitFor({ state: 'detached', timeout: 30_000 })
    } else {
      await repositoryList
        .getByRole('button', { name: 'Close', exact: true })
        .click()
      await repositoryList.waitFor({ state: 'detached' })
      await page.evaluate(() => {
        require('electron').ipcRenderer.emit(
          'menu-event',
          {},
          'add-local-repository'
        )
      })
      await addLocalHeading.waitFor({ state: 'visible', timeout: 10_000 })
    }
  }
  if (!(await history.isVisible()) || (await addLocalHeading.isVisible())) {
    if (!(await addLocalHeading.isVisible())) {
      await page.evaluate(() => {
        require('electron').ipcRenderer.emit(
          'menu-event',
          {},
          'add-local-repository'
        )
      })
      await addLocalHeading.waitFor({ state: 'visible', timeout: 10_000 })
    }
    const localPath = page.locator('#__TextBox_Local_path')
    await localPath.fill(repositoryPath)
    await localPath.blur()
    const add = page.getByRole('button', {
      name: 'Add repository',
      exact: true,
    })
    if (!(await add.isEnabled())) {
      fail('The deterministic CLI-open repository was not selectable.')
    }
    await add.click()
    await addLocalHeading.waitFor({ state: 'detached', timeout: 30_000 })
  }

  await currentRepositoryTitle
    .filter({ hasText: targetName })
    .waitFor({ state: 'visible', timeout: 30_000 })

  await history.waitFor({
    state: 'visible',
    timeout: 30_000,
  })
  await page.getByRole('tab', { name: 'Tools', exact: true }).waitFor({
    state: 'visible',
    timeout: 30_000,
  })
  await page.getByRole('button', { name: 'Search tabs', exact: true }).waitFor()
  const openRepositoryList = page.locator('.repository-list')
  if (await openRepositoryList.isVisible()) {
    await openRepositoryList
      .getByRole('button', { name: 'Close', exact: true })
      .click()
    await openRepositoryList.waitFor({ state: 'detached' })
  }
  for (const selector of ['.tab-search-popover', '.arrange-tabs']) {
    const surface = page.locator(selector)
    if (await surface.isVisible()) {
      await page.keyboard.press('Escape')
      await surface.waitFor({ state: 'detached' })
    }
  }
  await settle(page)
}

async function inspectDocument(page) {
  return page.evaluate(() => ({
    innerWidth,
    innerHeight,
    devicePixelRatio,
    documentClientWidth: document.documentElement.clientWidth,
    documentScrollWidth: document.documentElement.scrollWidth,
    bodyClientWidth: document.body.clientWidth,
    bodyScrollWidth: document.body.scrollWidth,
  }))
}

function assertDocument(receipt, label) {
  if (
    receipt.documentClientWidth !== receipt.documentScrollWidth ||
    receipt.bodyClientWidth !== receipt.bodyScrollWidth
  ) {
    fail(
      `${label} introduced page-level horizontal overflow: ${JSON.stringify(
        receipt
      )}`
    )
  }
}

async function inspectSurface(page, selector) {
  return page.evaluate(value => {
    const element = document.querySelector(value)
    if (!(element instanceof HTMLElement)) {
      return null
    }
    const rect = element.getBoundingClientRect()
    return {
      left: Math.round(rect.left),
      top: Math.round(rect.top),
      right: Math.round(rect.right),
      bottom: Math.round(rect.bottom),
      clientWidth: element.clientWidth,
      scrollWidth: element.scrollWidth,
      clientHeight: element.clientHeight,
      scrollHeight: element.scrollHeight,
      overflowX: getComputedStyle(element).overflowX,
      overflowY: getComputedStyle(element).overflowY,
      withinViewport:
        rect.left >= -1 &&
        rect.top >= -1 &&
        rect.right <= innerWidth + 1 &&
        rect.bottom <= innerHeight + 1,
      innerWidth,
      innerHeight,
    }
  }, selector)
}

function assertBoundedSurface(receipt, label) {
  if (
    receipt === null ||
    !receipt.withinViewport ||
    receipt.scrollWidth > receipt.clientWidth + 1
  ) {
    fail(`${label} clipping gate failed: ${JSON.stringify(receipt)}`)
  }
}

async function verifyButtonHint(page) {
  const settings = page.getByRole('button', { name: 'Settings', exact: true })
  await settings.evaluate(element => {
    element.blur()
    element.dispatchEvent(
      new MouseEvent('mouseout', {
        bubbles: true,
        relatedTarget: document.body,
      })
    )
  })
  await page.waitForTimeout(100)
  await settings.evaluate(element => {
    const rect = element.getBoundingClientRect()
    element.dispatchEvent(
      new MouseEvent('mouseover', {
        bubbles: true,
        relatedTarget: null,
        clientX: rect.left + rect.width / 2,
        clientY: rect.top + rect.height / 2,
      })
    )
  })
  const tooltip = page
    .locator('.tooltip')
    .filter({ hasText: 'Settings' })
    .last()
  await tooltip.waitFor({ state: 'visible', timeout: 5_000 })
  const receipt = {
    text: (await tooltip.textContent())?.replace(/\s+/g, ' ').trim(),
    target: await settings.getAttribute('data-tooltip-target'),
  }
  if (receipt.text !== 'Settings' || receipt.target === null) {
    fail(
      `The delegated Settings button hint was not owned: ${JSON.stringify(
        receipt
      )}`
    )
  }
  await settings.evaluate(element => {
    element.dispatchEvent(
      new MouseEvent('mouseout', {
        bubbles: true,
        relatedTarget: document.body,
      })
    )
  })
  await tooltip.waitFor({ state: 'hidden', timeout: 5_000 })
  return receipt
}

async function verifyTabActions(page, capture) {
  await page.getByRole('button', { name: 'Search tabs', exact: true }).click()
  const search = page.getByRole('combobox', {
    name: 'Search open tabs',
    exact: true,
  })
  await search.waitFor({ state: 'visible' })
  await search.fill('git-source')
  await page.getByText('1 matching tab', { exact: true }).waitFor()
  if (
    (await page
      .getByRole('listbox', {
        name: 'Matching repository tabs',
        exact: true,
      })
      .getByRole('option')
      .count()) !== 1
  ) {
    fail('Runtime tab search did not return the deterministic repository.')
  }
  const searchReceipt = await inspectSurface(page, '.tab-search-popover')
  assertBoundedSurface(searchReceipt, 'Runtime tab search')
  assertDocument(await inspectDocument(page), 'Runtime tab search')
  await page.screenshot({ path: capture })
  await search.press('Escape')
  await page.locator('.tab-search-popover').waitFor({ state: 'detached' })

  await page.getByRole('button', { name: 'Arrange tabs', exact: true }).click()
  const filter = page.getByRole('searchbox', {
    name: 'Filter tabs',
    exact: true,
  })
  await filter.waitFor({ state: 'visible' })
  await filter.fill('git-source')
  await page.getByText(/^1 of \d+ tabs$/).waitFor()
  await filter.fill('no-such-material-tab')
  await page.getByText('No tabs match this filter.', { exact: true }).waitFor()
  const arrangeReceipt = await inspectSurface(page, '.arrange-tabs')
  assertBoundedSurface(arrangeReceipt, 'Arrange-tabs filter')
  assertDocument(await inspectDocument(page), 'Arrange-tabs filter')
  await filter.press('Escape')
  await page.locator('.arrange-tabs').waitFor({ state: 'detached' })

  return { search: searchReceipt, arrange: arrangeReceipt }
}

async function verifyRepositoryScopes(page) {
  const currentRepository = page
    .locator('.toolbar-dropdown.foldout-style', {
      has: page.locator('.description', { hasText: 'Current repository' }),
    })
    .locator('.toolbar-button > button')
  await currentRepository.click()
  const list = page.locator('.repository-list')
  await list.waitFor({ state: 'visible' })
  const account = page.getByRole('combobox', {
    name: 'Repository account',
    exact: true,
  })
  const service = page.getByRole('combobox', {
    name: 'Repository service',
    exact: true,
  })
  await account.selectOption('unassigned')
  await service.selectOption('local')
  await list.getByRole('option', { name: /^git-source(?:,|$)/ }).waitFor({
    state: 'visible',
    timeout: 10_000,
  })
  await settle(page)
  const receipt = {
    account: await account.inputValue(),
    service: await service.inputValue(),
    surface: await inspectSurface(page, '.repository-list'),
  }
  assertBoundedSurface(receipt.surface, 'Repository account/service filters')
  assertDocument(
    await inspectDocument(page),
    'Repository account/service filters'
  )
  await page.getByRole('button', { name: 'Close', exact: true }).click()
  await list.waitFor({ state: 'detached' })
  return receipt
}

async function installContextMenuProbe(page) {
  await page.evaluate(() => {
    const ipcRenderer = require('electron').ipcRenderer
    const original = ipcRenderer.invoke.bind(ipcRenderer)
    globalThis.__materialContextMenuProbe = { original, menus: [] }
    ipcRenderer.invoke = (channel, ...args) => {
      if (channel === 'show-contextual-menu') {
        globalThis.__materialContextMenuProbe.menus.push(args[0])
        return Promise.resolve(null)
      }
      return original(channel, ...args)
    }
  })
}

async function restoreContextMenuProbe(page) {
  await page.evaluate(() => {
    const probe = globalThis.__materialContextMenuProbe
    if (probe !== undefined) {
      require('electron').ipcRenderer.invoke = probe.original
      delete globalThis.__materialContextMenuProbe
    }
  })
}

async function verifyHistoryContextActions(page, capture) {
  await page.getByRole('tab', { name: 'History', exact: true }).click()
  const commits = page.getByRole('listbox', { name: 'Commits', exact: true })
  await commits.waitFor({ state: 'visible', timeout: 30_000 })
  const row = commits.getByRole('option').first()
  await row.waitFor({ state: 'visible' })
  await installContextMenuProbe(page)
  try {
    await row.click({ button: 'right' })
    await page.waitForFunction(
      () => globalThis.__materialContextMenuProbe?.menus.length === 1,
      undefined,
      { timeout: 5_000 }
    )
    const firstLabels = await page.evaluate(() =>
      globalThis.__materialContextMenuProbe.menus[0]
        .map(item => item.label)
        .filter(label => typeof label === 'string')
    )
    for (const expected of [
      'Reset to commit…',
      'Checkout commit',
      'Create branch from commit',
      'Cherry-pick commit…',
      'Copy SHA',
    ]) {
      if (!firstLabels.includes(expected)) {
        fail(
          `History right-click omitted ${expected}: ${JSON.stringify(
            firstLabels
          )}`
        )
      }
    }

    const more = row.getByRole('button', { name: /^More actions for / })
    await more.click()
    await page.waitForFunction(
      () => globalThis.__materialContextMenuProbe?.menus.length === 2,
      undefined,
      { timeout: 5_000 }
    )
    const secondLabels = await page.evaluate(() =>
      globalThis.__materialContextMenuProbe.menus[1]
        .map(item => item.label)
        .filter(label => typeof label === 'string')
    )
    if (JSON.stringify(firstLabels) !== JSON.stringify(secondLabels)) {
      fail('History More actions and right-click did not expose the same menu.')
    }

    await more.evaluate(element => {
      const rect = element.getBoundingClientRect()
      element.dispatchEvent(
        new MouseEvent('mouseenter', {
          bubbles: false,
          relatedTarget: null,
          clientX: rect.left + rect.width / 2,
          clientY: rect.top + rect.height / 2,
        })
      )
    })
    await page
      .locator('.tooltip')
      .filter({ hasText: 'More actions' })
      .last()
      .waitFor({
        state: 'visible',
        timeout: 5_000,
      })
    await page.screenshot({ path: capture })
    assertDocument(await inspectDocument(page), 'History contextual actions')
    return {
      rowCount: await commits.getByRole('option').count(),
      labels: firstLabels,
    }
  } finally {
    await restoreContextMenuProbe(page)
  }
}

async function setMetrics(page, session, scenario) {
  await page.evaluate(
    zoom => require('electron').webFrame.setZoomFactor(zoom),
    scenario.zoom
  )
  await session.send('Emulation.setDeviceMetricsOverride', {
    width: scenario.width,
    height: scenario.height,
    deviceScaleFactor: 1,
    mobile: false,
    screenWidth: scenario.width,
    screenHeight: scenario.height,
  })
  await settle(page)
}

async function inspectToolsBottom(page) {
  return page.evaluate(() => {
    const tools = document.querySelector('.repository-tools')
    if (!(tools instanceof HTMLElement)) {
      return null
    }
    tools.scrollTop = tools.scrollHeight
    const controls = [
      ...tools.querySelectorAll(
        'button, input, select, textarea, a, [tabindex]'
      ),
    ].filter(element => {
      const rect = element.getBoundingClientRect()
      const style = getComputedStyle(element)
      return (
        style.display !== 'none' &&
        style.visibility !== 'hidden' &&
        rect.width > 0 &&
        rect.height > 0
      )
    })
    const last = controls.reduce((candidate, element) => {
      if (candidate === null) {
        return element
      }
      return element.getBoundingClientRect().bottom >
        candidate.getBoundingClientRect().bottom
        ? element
        : candidate
    }, null)
    last?.scrollIntoView({ block: 'nearest' })
    const rect = tools.getBoundingClientRect()
    const lastRect = last?.getBoundingClientRect()
    return {
      viewport: { width: innerWidth, height: innerHeight },
      rect: {
        left: Math.round(rect.left),
        top: Math.round(rect.top),
        right: Math.round(rect.right),
        bottom: Math.round(rect.bottom),
      },
      clientWidth: tools.clientWidth,
      scrollWidth: tools.scrollWidth,
      clientHeight: tools.clientHeight,
      scrollHeight: tools.scrollHeight,
      scrollTop: tools.scrollTop,
      maxScrollTop: tools.scrollHeight - tools.clientHeight,
      overflowX: getComputedStyle(tools).overflowX,
      overflowY: getComputedStyle(tools).overflowY,
      lastControl:
        last instanceof HTMLElement && lastRect !== undefined
          ? {
              label:
                last.getAttribute('aria-label') ??
                last.textContent?.replace(/\s+/g, ' ').trim(),
              top: Math.round(lastRect.top),
              bottom: Math.round(lastRect.bottom),
              withinSurface:
                lastRect.top >= rect.top - 1 &&
                lastRect.bottom <= rect.bottom + 1,
              withinViewport:
                lastRect.top >= -1 && lastRect.bottom <= innerHeight + 1,
            }
          : null,
    }
  })
}

function assertTools(receipt, label) {
  if (
    receipt === null ||
    receipt.rect.left < -1 ||
    receipt.rect.top < -1 ||
    receipt.rect.right > receipt.viewport.width + 1 ||
    receipt.rect.bottom > receipt.viewport.height + 1 ||
    receipt.scrollWidth > receipt.clientWidth + 1 ||
    receipt.scrollHeight <= receipt.clientHeight ||
    !['auto', 'scroll'].includes(receipt.overflowY) ||
    receipt.overflowX !== 'hidden' ||
    Math.abs(receipt.scrollTop - receipt.maxScrollTop) > 2 ||
    receipt.lastControl === null ||
    !receipt.lastControl.withinSurface ||
    !receipt.lastControl.withinViewport
  ) {
    fail(
      `${label} Repository Tools bottom gate failed: ${JSON.stringify(receipt)}`
    )
  }
}

async function verifyRepositoryTools(page, capture) {
  await page.getByRole('tab', { name: 'Tools', exact: true }).click()
  await page
    .getByRole('main', { name: 'Repository tools', exact: true })
    .waitFor({
      state: 'visible',
      timeout: 30_000,
    })

  const session = await page.context().newCDPSession(page)
  const scenarios = [
    { name: 'regular', width: 1000, height: 687, zoom: 1 },
    { name: 'minimum', width: 640, height: 480, zoom: 1 },
    { name: 'short', width: 960, height: 420, zoom: 1 },
    { name: 'zoom-150', width: 1000, height: 687, zoom: 1.5 },
  ]
  const receipts = []
  try {
    for (const scenario of scenarios) {
      await setMetrics(page, session, scenario)
      const receipt = await inspectToolsBottom(page)
      assertTools(receipt, scenario.name)
      assertDocument(
        await inspectDocument(page),
        `${scenario.name} Repository Tools`
      )
      receipts.push({ scenario, receipt })
      if (scenario.name === 'short') {
        await page.screenshot({ path: capture })
      }
    }
  } finally {
    await page.evaluate(() => require('electron').webFrame.setZoomFactor(1))
    await session.send('Emulation.clearDeviceMetricsOverride')
    await settle(page)
  }
  return receipts
}

async function main() {
  const options = parseArguments(process.argv.slice(2))
  const browser = await connect(options.port)
  const page = await getRenderer(browser)

  await prepareApp(page, options.repositoryPath)
  const hint = await verifyButtonHint(page)
  const tabs = await verifyTabActions(page, options.tabsCapture)
  const repositoryScopes = await verifyRepositoryScopes(page)
  const history = await verifyHistoryContextActions(
    page,
    options.historyCapture
  )
  const tools = await verifyRepositoryTools(page, options.toolsCapture)

  process.stdout.write(
    `${JSON.stringify({ hint, tabs, repositoryScopes, history, tools })}\n`
  )
  process.exit(0)
}

main().catch(error => {
  process.stderr.write(`${error.stack ?? error}\n`)
  process.exit(1)
})
