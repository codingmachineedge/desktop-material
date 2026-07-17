#!/usr/bin/env node
'use strict'

/*
 * Bounded renderer verifier for the custom repository-logo milestone. The
 * caller owns the production build, Electron process, explicitly chosen
 * loopback CDP port, isolated user data, deterministic repository fixture,
 * off-screen desktop, screenshot directory, and native cleanup. This helper
 * only connects to the already-running renderer. It never opens a native file
 * dialog and restores the repository to its inherited profile logo.
 */

const crypto = require('crypto')
const fs = require('fs')
const path = require('path')
const { chromium } = require('playwright')

const CustomText = 'DM-CDP'
const ShortViewport = { width: 960, height: 420, zoom: 1 }
const RequiredArguments = new Set([
  'port',
  'run-root',
  'repository-path',
  'capture',
])
const AllowedArguments = new Set([...RequiredArguments, 'overview-capture'])

function fail(message) {
  throw new Error(message)
}

function samePath(left, right) {
  const normalize = value =>
    process.platform === 'win32' ? value.toLowerCase() : value
  return normalize(path.resolve(left)) === normalize(path.resolve(right))
}

function relativeInside(parent, child) {
  const relative = path.relative(parent, child)
  return (
    relative.length > 0 &&
    !relative.startsWith('..') &&
    !path.isAbsolute(relative)
  )
}

function existingRealDirectory(value, label) {
  if (value === undefined) {
    fail(`${label} is required.`)
  }
  const resolved = path.resolve(value)
  if (!fs.existsSync(resolved) || !fs.statSync(resolved).isDirectory()) {
    fail(`${label} must be an existing directory.`)
  }
  const real = fs.realpathSync.native(resolved)
  if (!samePath(real, resolved)) {
    fail(`${label} must not traverse a symbolic link.`)
  }
  return real
}

function parseArguments(argv) {
  if (argv.length === 0 || argv.length % 2 !== 0) {
    fail('Expected explicit --name value argument pairs.')
  }

  const values = new Map()
  for (let index = 0; index < argv.length; index += 2) {
    const flag = argv[index]
    const value = argv[index + 1]
    const name = flag?.startsWith('--') ? flag.slice(2) : null
    if (
      name === null ||
      value === undefined ||
      !AllowedArguments.has(name) ||
      values.has(name)
    ) {
      fail(`Invalid or duplicate argument near ${flag ?? '<end>'}.`)
    }
    values.set(name, value)
  }
  if ([...RequiredArguments].some(name => !values.has(name))) {
    fail('port, run-root, repository-path, and capture are all required.')
  }

  const port = Number(values.get('port'))
  if (!Number.isSafeInteger(port) || port < 1 || port > 65535) {
    fail('A valid explicitly supplied loopback CDP port is required.')
  }

  const runRoot = existingRealDirectory(values.get('run-root'), 'run-root')
  if (!path.basename(runRoot).startsWith('desktop-material-p0-ui-')) {
    fail('The owned run root name is invalid.')
  }

  const repositoryPath = existingRealDirectory(
    values.get('repository-path'),
    'repository-path'
  )
  if (
    !relativeInside(runRoot, repositoryPath) ||
    !fs.existsSync(path.join(repositoryPath, '.git')) ||
    !fs.statSync(path.join(repositoryPath, '.git')).isDirectory()
  ) {
    fail(
      'The deterministic Git repository must remain inside the owned run root.'
    )
  }

  const ownedCapture = (name, required) => {
    const value = values.get(name)
    if (value === undefined) {
      if (required) fail(`${name} is required.`)
      return null
    }
    const resolved = path.resolve(value)
    if (path.extname(resolved).toLocaleLowerCase() !== '.png') {
      fail(`${name} must be a PNG file.`)
    }
    if (fs.existsSync(resolved)) {
      fail(`${name} must be a new file.`)
    }
    const parent = existingRealDirectory(
      path.dirname(resolved),
      `${name} parent`
    )
    const canonical = path.join(parent, path.basename(resolved))
    if (!samePath(canonical, resolved) || !relativeInside(runRoot, canonical)) {
      fail(`${name} must remain inside the owned run root without symlinks.`)
    }
    return canonical
  }

  return {
    port,
    runRoot,
    repositoryPath,
    repositoryName: path.basename(repositoryPath),
    capture: ownedCapture('capture', true),
    overviewCapture: ownedCapture('overview-capture', false),
  }
}

async function connect(port) {
  const deadline = Date.now() + 20_000
  let lastError = null
  while (Date.now() < deadline) {
    try {
      // Intentionally fixed to loopback. The caller may choose only the port.
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

async function settle(page, delay = 350) {
  await page.waitForTimeout(delay)
  await page.locator('#window-zoom-info').waitFor({
    state: 'detached',
    timeout: 5_000,
  })
}

async function waitUntilEnabled(locator, label) {
  const deadline = Date.now() + 15_000
  while (Date.now() < deadline) {
    if ((await locator.count()) > 0 && (await locator.isEnabled())) {
      return
    }
    await new Promise(resolve => setTimeout(resolve, 100))
  }
  fail(`${label} did not become enabled.`)
}

async function emitMenuEvent(page, name) {
  await page.evaluate(value => {
    require('electron').ipcRenderer.emit('menu-event', {}, value)
  }, name)
}

async function prepareApp(page, repositoryPath) {
  await page.locator('body').waitFor({ state: 'visible', timeout: 30_000 })

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
  }

  await page.locator('#desktop-app-contents').waitFor({
    state: 'visible',
    timeout: 30_000,
  })

  const continueWithoutAccount = page.getByRole('link', {
    name: 'Continue without signing in',
    exact: true,
  })
  if (await continueWithoutAccount.isVisible()) {
    await continueWithoutAccount.click()
  }

  const history = page.getByRole('tab', { name: 'History', exact: true })
  await page.waitForTimeout(500)
  if (!(await history.isVisible())) {
    const addHeading = page.getByRole('heading', {
      name: 'Add local repository',
      exact: true,
    })
    if (!(await addHeading.isVisible())) {
      await page
        .getByRole('button', { name: /Add an Existing Repository/ })
        .click()
      await addHeading.waitFor({ state: 'visible', timeout: 10_000 })
    }
    const localPath = page.locator('#__TextBox_Local_path')
    await localPath.fill(repositoryPath)
    await localPath.blur()
    const add = page.getByRole('button', {
      name: 'Add repository',
      exact: true,
    })
    await waitUntilEnabled(add, 'Add repository')
    await add.click()
    await addHeading.waitFor({ state: 'detached', timeout: 30_000 })
  }

  await history.waitFor({ state: 'visible', timeout: 30_000 })
  const selectedTab = page.locator('.repository-tab[aria-selected="true"]')
  await selectedTab.waitFor({
    state: 'visible',
    timeout: 30_000,
  })
  const selectedLabel = (await selectedTab.textContent())
    ?.replace(/\s+/g, ' ')
    .trim()
  if (!selectedLabel?.includes(path.basename(repositoryPath))) {
    fail(
      `The selected repository tab does not match the owned fixture: ${
        selectedLabel ?? '<empty>'
      }.`
    )
  }
  await settle(page)
}

async function openAppearance(page) {
  await emitMenuEvent(page, 'show-repository-settings')
  const dialog = page.locator('#repository-settings')
  await dialog.waitFor({ state: 'visible', timeout: 10_000 })
  await dialog.getByRole('tab', { name: 'Appearance', exact: true }).click()
  const studio = dialog.locator('.repository-logo-studio')
  await studio.waitFor({ state: 'visible', timeout: 10_000 })
  await waitUntilEnabled(
    studio.getByRole('button', { name: 'Monogram', exact: true }),
    'Repository logo editor'
  )
  return { dialog, studio }
}

async function assertCleanFixture(studio) {
  const inherited = studio.getByRole('button', {
    name: 'Inherit profile logo',
    exact: true,
  })
  if (!(await inherited.isDisabled())) {
    fail(
      'The isolated fixture already has a repository-logo override; use a fresh deterministic fixture.'
    )
  }
  await studio.getByText('Profile default', { exact: true }).waitFor({
    state: 'visible',
    timeout: 5_000,
  })
}

async function studioReceipt(studio) {
  return studio.evaluate((root, expectedText) => {
    const preview = root.querySelector('.repository-logo-preview svg')
    const selected = root.querySelector(
      '.repository-logo-layer-tabs [role="tab"][aria-selected="true"]'
    )
    return {
      layers: [
        ...root.querySelectorAll('.repository-logo-layer-tabs [role="tab"]'),
      ].map(element => element.textContent?.replace(/\s+/g, ' ').trim()),
      selectedLayer: selected?.textContent?.replace(/\s+/g, ' ').trim(),
      previewText: preview?.textContent?.replace(/\s+/g, ' ').trim(),
      containsExpectedText:
        preview?.textContent?.includes(expectedText) === true,
      importButton: [...root.querySelectorAll('button')].some(
        button => button.textContent?.trim() === 'Import JSON…'
      ),
      exportButton: [...root.querySelectorAll('button')].some(
        button => button.textContent?.trim() === 'Export JSON…'
      ),
    }
  }, CustomText)
}

async function exerciseStudio(studio) {
  await studio.getByRole('button', { name: 'Monogram', exact: true }).click()
  await studio
    .getByRole('tab', { name: 'Monogram mark', exact: true })
    .waitFor({ state: 'visible', timeout: 5_000 })

  await studio.getByRole('button', { name: 'Add text', exact: true }).click()
  const customText = studio.getByRole('textbox', {
    name: 'Custom text',
    exact: true,
  })
  await customText.waitFor({ state: 'visible', timeout: 5_000 })
  if ((await studio.getByRole('tab').count()) < 2) {
    fail('Adding a text layer did not produce a second editable layer.')
  }

  await customText.fill(CustomText)
  await studio
    .getByRole('tab', { name: `Text: ${CustomText}`, exact: true })
    .waitFor({ state: 'visible', timeout: 5_000 })
  await studio.getByText(CustomText, { exact: true }).waitFor({
    state: 'visible',
    timeout: 5_000,
  })

  const undo = studio.getByRole('button', { name: 'Undo', exact: true })
  const redo = studio.getByRole('button', { name: 'Redo', exact: true })
  await waitUntilEnabled(undo, 'Undo')
  await undo.click()
  await pageWaitForInputValue(customText, 'DM', 'Undo')
  await waitUntilEnabled(redo, 'Redo')
  await redo.click()
  await pageWaitForInputValue(customText, CustomText, 'Redo')

  const receipt = await studioReceipt(studio)
  if (
    receipt.layers.length !== 2 ||
    !receipt.layers.includes('Monogram mark') ||
    !receipt.layers.includes(`Text: ${CustomText}`) ||
    !receipt.containsExpectedText ||
    !receipt.importButton ||
    !receipt.exportButton
  ) {
    fail(
      `Repository logo studio interaction failed: ${JSON.stringify(receipt)}`
    )
  }
  return receipt
}

async function pageWaitForInputValue(locator, expected, label) {
  const deadline = Date.now() + 5_000
  while (Date.now() < deadline) {
    if ((await locator.inputValue()) === expected) {
      return
    }
    await new Promise(resolve => setTimeout(resolve, 50))
  }
  fail(`${label} did not restore the expected layer value.`)
}

async function setShortMetrics(page, session) {
  await page.evaluate(
    zoom => require('electron').webFrame.setZoomFactor(zoom),
    ShortViewport.zoom
  )
  await session.send('Emulation.setDeviceMetricsOverride', {
    width: ShortViewport.width,
    height: ShortViewport.height,
    deviceScaleFactor: 1,
    mobile: false,
    screenWidth: ShortViewport.width,
    screenHeight: ShortViewport.height,
  })
  await settle(page, 600)
}

async function restoreMetrics(page, session) {
  await page.evaluate(() => require('electron').webFrame.setZoomFactor(1))
  await session.send('Emulation.clearDeviceMetricsOverride')
  await settle(page)
}

async function inspectShortBottom(page) {
  const bottomProof = await page.evaluate(() => {
    const dialog = document.querySelector('#repository-settings')
    if (!(dialog instanceof HTMLElement)) {
      throw new Error('Repository settings is not visible.')
    }
    const visible = element => {
      const style = getComputedStyle(element)
      const rect = element.getBoundingClientRect()
      return (
        style.display !== 'none' &&
        style.visibility !== 'hidden' &&
        rect.width > 0 &&
        rect.height > 0
      )
    }
    const proof = []
    for (const element of [dialog, ...dialog.querySelectorAll('*')]) {
      if (!(element instanceof HTMLElement) || !visible(element)) {
        continue
      }
      const overflowY = getComputedStyle(element).overflowY
      if (
        element.scrollHeight > element.clientHeight + 1 &&
        (overflowY === 'auto' || overflowY === 'scroll')
      ) {
        element.scrollTop = element.scrollHeight
        proof.push({
          label:
            element.id ||
            [...element.classList].slice(0, 3).join('.') ||
            element.tagName.toLocaleLowerCase(),
          clientHeight: element.clientHeight,
          scrollHeight: element.scrollHeight,
          scrollTop: element.scrollTop,
          maxScrollTop: element.scrollHeight - element.clientHeight,
          reachedBottom:
            Math.abs(
              element.scrollTop - (element.scrollHeight - element.clientHeight)
            ) <= 2,
        })
      }
    }
    return proof
  })
  const dialog = page.locator('#repository-settings')
  await dialog
    .getByRole('button', { name: 'Export JSON…', exact: true })
    .scrollIntoViewIfNeeded()
  await settle(page, 250)

  const receipt = await page.evaluate(provenScrollOwners => {
    const dialog = document.querySelector('#repository-settings')
    const studio = dialog?.querySelector('.repository-logo-studio')
    const editor = dialog?.querySelector('.repository-logo-editor-scroll')
    const exportButton = [...(dialog?.querySelectorAll('button') ?? [])].find(
      button => button.textContent?.trim() === 'Export JSON…'
    )
    const saveButton = [...(dialog?.querySelectorAll('button') ?? [])].find(
      button => button.textContent?.trim() === 'Save'
    )
    const cancelButton = [...(dialog?.querySelectorAll('button') ?? [])].find(
      button => button.textContent?.trim() === 'Cancel'
    )
    if (
      !(dialog instanceof HTMLElement) ||
      !(studio instanceof HTMLElement) ||
      !(editor instanceof HTMLElement) ||
      !(exportButton instanceof HTMLElement) ||
      !(saveButton instanceof HTMLElement) ||
      !(cancelButton instanceof HTMLElement)
    ) {
      throw new Error('Short-layout geometry is incomplete.')
    }
    const visible = element => {
      const style = getComputedStyle(element)
      const rect = element.getBoundingClientRect()
      return (
        style.display !== 'none' &&
        style.visibility !== 'hidden' &&
        rect.width > 0 &&
        rect.height > 0
      )
    }
    const rect = element => {
      const value = element.getBoundingClientRect()
      return {
        left: Math.round(value.left),
        top: Math.round(value.top),
        right: Math.round(value.right),
        bottom: Math.round(value.bottom),
        withinViewport:
          value.left >= -1 &&
          value.top >= -1 &&
          value.right <= innerWidth + 1 &&
          value.bottom <= innerHeight + 1,
      }
    }
    const currentScrollOwners = [dialog, ...dialog.querySelectorAll('*')]
      .filter(
        element =>
          element instanceof HTMLElement &&
          visible(element) &&
          element.scrollHeight > element.clientHeight + 1 &&
          ['auto', 'scroll'].includes(getComputedStyle(element).overflowY)
      )
      .map(element => ({
        label:
          element.id ||
          [...element.classList].slice(0, 3).join('.') ||
          element.tagName.toLocaleLowerCase(),
        clientHeight: element.clientHeight,
        scrollHeight: element.scrollHeight,
        scrollTop: element.scrollTop,
        maxScrollTop: element.scrollHeight - element.clientHeight,
        reachedBottom:
          Math.abs(
            element.scrollTop - (element.scrollHeight - element.clientHeight)
          ) <= 2,
      }))

    return {
      viewport: { width: innerWidth, height: innerHeight },
      document: {
        clientWidth: document.documentElement.clientWidth,
        scrollWidth: document.documentElement.scrollWidth,
        bodyClientWidth: document.body.clientWidth,
        bodyScrollWidth: document.body.scrollWidth,
      },
      dialog: {
        ...rect(dialog),
        clientWidth: dialog.clientWidth,
        scrollWidth: dialog.scrollWidth,
      },
      studio: {
        ...rect(studio),
        clientWidth: studio.clientWidth,
        scrollWidth: studio.scrollWidth,
      },
      editor: {
        ...rect(editor),
        overflowY: getComputedStyle(editor).overflowY,
        clientHeight: editor.clientHeight,
        scrollHeight: editor.scrollHeight,
        scrollTop: editor.scrollTop,
        maxScrollTop: editor.scrollHeight - editor.clientHeight,
      },
      scrollOwners: provenScrollOwners,
      currentScrollOwners,
      exportButton: rect(exportButton),
      saveButton: rect(saveButton),
      cancelButton: rect(cancelButton),
    }
  }, bottomProof)

  const editorAtBottom =
    Math.abs(receipt.editor.scrollTop - receipt.editor.maxScrollTop) <= 2
  if (
    receipt.viewport.width !== ShortViewport.width ||
    receipt.viewport.height !== ShortViewport.height ||
    receipt.document.scrollWidth > receipt.document.clientWidth + 1 ||
    receipt.document.bodyScrollWidth > receipt.document.bodyClientWidth + 1 ||
    !receipt.dialog.withinViewport ||
    receipt.dialog.scrollWidth > receipt.dialog.clientWidth + 1 ||
    receipt.studio.scrollWidth > receipt.studio.clientWidth + 1 ||
    receipt.editor.scrollHeight <= receipt.editor.clientHeight ||
    !['auto', 'scroll'].includes(receipt.editor.overflowY) ||
    !editorAtBottom ||
    receipt.scrollOwners.some(owner => !owner.reachedBottom) ||
    !receipt.exportButton.withinViewport ||
    !receipt.saveButton.withinViewport ||
    !receipt.cancelButton.withinViewport
  ) {
    fail(`Short-height bottom gate failed: ${JSON.stringify(receipt)}`)
  }
  return receipt
}

function logoReceipt(element, expectedText) {
  const svg = element.matches('svg') ? element : element.querySelector('svg')
  return {
    className: svg?.getAttribute('class'),
    text: svg?.textContent?.replace(/\s+/g, ' ').trim(),
    ariaHidden: svg?.getAttribute('aria-hidden'),
    containsExpectedText: svg?.textContent?.includes(expectedText) === true,
  }
}

async function verifyPropagation(page, repositoryName) {
  await page.waitForFunction(
    text =>
      document
        .querySelector(
          '.repository-tab[aria-selected="true"] svg.repository-tab-icon'
        )
        ?.textContent?.includes(text) === true,
    CustomText,
    { timeout: 15_000 }
  )
  const tab = await page
    .locator('.repository-tab[aria-selected="true"] svg.repository-tab-icon')
    .evaluate(logoReceipt, CustomText)

  // The deterministic directory name need not match the repository's display
  // name (for example, a fixture folder named `fixture` can be configured as
  // `material-fixture`). Use the active tab's accessible name for the actual
  // repository switcher and list propagation checks.
  const repositoryDisplayName =
    (await page
      .locator('.repository-tab[aria-selected="true"]')
      .getAttribute('aria-label')) ?? repositoryName

  const repositoryButton = page
    .getByRole('button', { name: repositoryDisplayName, exact: true })
    .first()
  await repositoryButton.click()
  const list = page.locator('.repository-list')
  await list.waitFor({ state: 'visible', timeout: 10_000 })
  const repositoryNamePattern = new RegExp(
    repositoryDisplayName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'),
    'i'
  )
  const row = list.getByRole('option', { name: repositoryNamePattern }).first()
  await row.waitFor({ state: 'visible', timeout: 10_000 })
  await page.waitForFunction(
    ({ name, text }) => {
      const rows = [
        ...document.querySelectorAll('.repository-list [role="option"]'),
      ]
      const row = rows.find(element =>
        (element.getAttribute('aria-label') ?? '')
          .toLocaleLowerCase()
          .includes(name.toLocaleLowerCase())
      )
      return (
        row
          ?.querySelector('svg.repository-list-logo')
          ?.textContent?.includes(text) === true
      )
    },
    { name: repositoryDisplayName, text: CustomText },
    { timeout: 15_000 }
  )
  const listLogo = await row
    .locator('svg.repository-list-logo')
    .evaluate(logoReceipt, CustomText)
  if (
    !tab.containsExpectedText ||
    !listLogo.containsExpectedText ||
    tab.ariaHidden !== 'true' ||
    listLogo.ariaHidden !== 'true'
  ) {
    fail(
      `Saved logo did not propagate accessibly: ${JSON.stringify({
        tab,
        list: listLogo,
      })}`
    )
  }

  await list.getByRole('button', { name: 'Close', exact: true }).click()
  await list.waitFor({ state: 'detached', timeout: 10_000 })
  return { tab, list: listLogo }
}

async function restoreInheritedLogo(page) {
  const openList = page.locator('.repository-list')
  if (await openList.isVisible()) {
    await openList.getByRole('button', { name: 'Close', exact: true }).click()
    await openList.waitFor({ state: 'detached', timeout: 10_000 })
  }

  let dialog = page.locator('#repository-settings')
  if (!(await dialog.isVisible())) {
    const opened = await openAppearance(page)
    dialog = opened.dialog
  } else {
    await dialog.getByRole('tab', { name: 'Appearance', exact: true }).click()
  }
  const studio = dialog.locator('.repository-logo-studio')
  await studio.waitFor({ state: 'visible', timeout: 10_000 })
  const inherit = studio.getByRole('button', {
    name: 'Inherit profile logo',
    exact: true,
  })
  if (await inherit.isEnabled()) {
    await inherit.click()
    await dialog.getByRole('button', { name: 'Save', exact: true }).click()
  } else {
    await dialog.getByRole('button', { name: 'Cancel', exact: true }).click()
  }
  await dialog.waitFor({ state: 'detached', timeout: 30_000 })

  const reopened = await openAppearance(page)
  const finalInherit = reopened.studio.getByRole('button', {
    name: 'Inherit profile logo',
    exact: true,
  })
  if (!(await finalInherit.isDisabled())) {
    fail('The repository-logo override remained after cleanup.')
  }
  await reopened.studio.getByText('Profile default', { exact: true }).waitFor({
    state: 'visible',
    timeout: 5_000,
  })
  await page.waitForFunction(
    text =>
      document
        .querySelector(
          '.repository-tab[aria-selected="true"] svg.repository-tab-icon'
        )
        ?.textContent?.includes(text) !== true,
    CustomText,
    { timeout: 15_000 }
  )
  const receipt = {
    inherited: true,
    profileDefaultVisible: true,
    customTextStillInTab:
      (
        await page
          .locator(
            '.repository-tab[aria-selected="true"] svg.repository-tab-icon'
          )
          .textContent()
      )?.includes(CustomText) === true,
  }
  await reopened.dialog
    .getByRole('button', { name: 'Cancel', exact: true })
    .click()
  await reopened.dialog.waitFor({ state: 'detached', timeout: 10_000 })
  if (receipt.customTextStillInTab) {
    fail(`The inherited tab logo remained stale: ${JSON.stringify(receipt)}`)
  }
  return receipt
}

async function closeOpenSettings(page) {
  const dialog = page.locator('#repository-settings')
  if (!(await dialog.isVisible())) {
    return
  }
  const cancel = dialog.getByRole('button', { name: 'Cancel', exact: true })
  if ((await cancel.count()) > 0 && (await cancel.isVisible())) {
    await cancel.click()
    await dialog.waitFor({ state: 'detached', timeout: 10_000 })
  }
}

async function captureReceipt(page, options, capturePath) {
  const buffer = await page.screenshot({ path: capturePath })
  if (
    !fs.existsSync(capturePath) ||
    buffer.length < 2_048 ||
    !buffer.equals(fs.readFileSync(capturePath))
  ) {
    fail('The repository-logo screenshot was not written completely.')
  }
  const viewport = await page.evaluate(() => ({
    width: innerWidth,
    height: innerHeight,
  }))
  return {
    path: path.relative(options.runRoot, capturePath).replace(/\\/g, '/'),
    bytes: buffer.length,
    sha256: crypto.createHash('sha256').update(buffer).digest('hex'),
    ...viewport,
    zoom: await page.evaluate(() =>
      require('electron').webFrame.getZoomFactor()
    ),
  }
}

async function verify(page, options) {
  const session = await page.context().newCDPSession(page)
  let metricsApplied = false
  let customMayBePersisted = false
  let primaryError = null
  let cleanupError = null
  let result = null

  try {
    await prepareApp(page, options.repositoryPath)
    const { dialog, studio } = await openAppearance(page)
    await assertCleanFixture(studio)
    const interaction = await exerciseStudio(studio)

    let overviewCapture = null
    if (options.overviewCapture !== null) {
      await page.evaluate(() => {
        const activeTab = document.querySelector(
          '#repository-settings .active-tab'
        )
        const editor = document.querySelector('.repository-logo-editor-scroll')
        if (activeTab instanceof HTMLElement) activeTab.scrollTop = 0
        if (editor instanceof HTMLElement) editor.scrollTop = 0
        document
          .querySelector('.repository-logo-studio')
          ?.scrollIntoView({ block: 'start', inline: 'nearest' })
      })
      await settle(page, 300)
      overviewCapture = await captureReceipt(
        page,
        options,
        options.overviewCapture
      )
    }

    await setShortMetrics(page, session)
    metricsApplied = true
    const shortLayout = await inspectShortBottom(page)
    const capture = await captureReceipt(page, options, options.capture)

    customMayBePersisted = true
    await dialog.getByRole('button', { name: 'Save', exact: true }).click()
    await dialog.waitFor({ state: 'detached', timeout: 30_000 })
    const propagation = await verifyPropagation(page, options.repositoryName)
    const cleanup = await restoreInheritedLogo(page)
    customMayBePersisted = false

    result = {
      interaction,
      shortLayout,
      propagation,
      overviewCapture,
      capture,
      cleanup,
    }
  } catch (error) {
    primaryError = error
  } finally {
    if (metricsApplied) {
      try {
        await restoreMetrics(page, session)
      } catch (error) {
        cleanupError = error
      }
    }

    try {
      if (customMayBePersisted) {
        await restoreInheritedLogo(page)
      } else {
        await closeOpenSettings(page)
      }
    } catch (error) {
      cleanupError ??= error
    }
  }

  if (primaryError !== null || cleanupError !== null) {
    const primary =
      primaryError instanceof Error ? primaryError.stack : String(primaryError)
    const cleanup =
      cleanupError instanceof Error ? cleanupError.stack : String(cleanupError)
    fail(
      [
        primaryError !== null ? `Verification: ${primary}` : null,
        cleanupError !== null ? `Cleanup: ${cleanup}` : null,
      ]
        .filter(Boolean)
        .join('\n')
    )
  }
  return result
}

async function main() {
  const options = parseArguments(process.argv.slice(2))
  const browser = await connect(options.port)
  const page = await getRenderer(browser)
  const receipt = await verify(page, options)
  process.stdout.write(`${JSON.stringify(receipt)}\n`)
  // Do not Browser.close() a caller-owned Electron process. Exiting drops only
  // this verifier's CDP client connection.
  process.exit(0)
}

main().catch(error => {
  process.stderr.write(`${error.stack ?? error}\n`)
  process.exit(1)
})
