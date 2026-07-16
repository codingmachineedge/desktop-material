#!/usr/bin/env node
'use strict'

/**
 * Isolated renderer verifier for the clone-style Add Submodule dialog.
 * The caller owns Electron, its loopback CDP port, fixture profile, captures,
 * and cleanup. This script never launches, focuses, resizes, or closes a window.
 */

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

  const capture = values.get('capture')
  const compactCapture = values.get('compact-capture')
  for (const candidate of [capture, compactCapture]) {
    if (
      candidate === undefined ||
      path
        .resolve(candidate)
        .toLowerCase()
        .includes('desktop-material-add-submodule-')
    ) {
      continue
    }
    fail('Captures must stay inside the owned Add Submodule run root.')
  }

  if (capture === undefined || compactCapture === undefined) {
    fail('Desktop and compact capture paths are required.')
  }

  return { port, capture, compactCapture }
}

async function getRenderer(browser) {
  const pages = browser.contexts().flatMap(context => context.pages())
  const page = pages.find(candidate =>
    candidate.url().includes('/out/index.html')
  )
  if (page === undefined) {
    fail('The isolated Desktop Material renderer target was not found.')
  }
  return page
}

async function openDialog(page) {
  const repositorySettings = page.getByRole('dialog', {
    name: 'Repository settings',
  })
  if (!(await repositorySettings.isVisible())) {
    await page.evaluate(() => {
      require('electron').ipcRenderer.emit(
        'menu-event',
        {},
        'show-repository-settings'
      )
    })
  }
  await repositorySettings.waitFor({ state: 'visible', timeout: 15_000 })

  await repositorySettings.getByRole('tab', { name: 'Submodules' }).click()
  await repositorySettings
    .getByRole('heading', { name: 'Submodules' })
    .waitFor({ state: 'visible', timeout: 15_000 })
  await repositorySettings
    .getByRole('button', { name: /Add submodule/ })
    .click()

  const dialog = page.getByRole('dialog', { name: 'Add a submodule' })
  await dialog.waitFor({ state: 'visible', timeout: 15_000 })

  const urlTab = dialog.getByRole('tab', { name: 'URL' })
  const enterpriseTab = dialog.getByRole('tab', {
    name: 'GitHub Enterprise',
  })
  await urlTab.click()
  await urlTab.focus()
  await page.keyboard.press('ArrowLeft')
  await enterpriseTab.waitFor({ state: 'visible' })
  if ((await enterpriseTab.getAttribute('aria-selected')) !== 'true') {
    fail('ArrowLeft did not select the previous provider tab.')
  }
  await page.keyboard.press('ArrowRight')
  if ((await urlTab.getAttribute('aria-selected')) !== 'true') {
    fail('ArrowRight did not restore the URL provider tab.')
  }

  await dialog
    .getByLabel('Repository URL')
    .fill('https://example.invalid/shared-library.git')
  await dialog
    .getByLabel('Path inside repository')
    .fill('vendor/shared-library')
  await dialog.getByLabel('Branch (optional)').fill('stable')
  await dialog.getByLabel('Branch (optional)').press('Tab')
  await page.waitForFunction(
    () =>
      !document.body.innerText.includes(
        'Checking that the destination is safe and empty'
      )
  )

  if (
    !(await dialog.getByRole('button', { name: 'Add submodule' }).isEnabled())
  ) {
    fail('The reviewed synthetic submodule could not be submitted.')
  }

  return dialog
}

async function assertReachable(dialog) {
  const controls = [
    dialog.getByRole('tab', { name: 'GitHub.com' }),
    dialog.getByRole('tab', { name: 'GitHub Enterprise' }),
    dialog.getByRole('tab', { name: 'URL' }),
    dialog.getByRole('tab', { name: 'GitLab & Bitbucket' }),
    dialog.getByLabel('Repository URL'),
    dialog.getByLabel('Path inside repository'),
    dialog.getByLabel('Branch (optional)'),
    dialog.getByRole('region', { name: 'Submodule review' }),
    dialog.getByRole('button', { name: 'Add submodule' }),
    dialog.getByRole('button', { name: 'Cancel' }),
  ]

  for (const control of controls) {
    await control.scrollIntoViewIfNeeded()
    if (!(await control.isVisible())) {
      fail(
        `Required control is not reachable: ${await control.evaluate(
          e => e.outerHTML
        )}`
      )
    }
  }
}

async function inspect(page) {
  return page.evaluate(() => {
    const dialog = document.querySelector('.add-submodule-dialog')
    const scrollRegion = document.querySelector('.add-submodule-scroll-region')
    if (!(dialog instanceof HTMLElement)) {
      throw new Error('Add Submodule dialog element was not found.')
    }
    if (!(scrollRegion instanceof HTMLElement)) {
      throw new Error('Add Submodule scroll region was not found.')
    }

    const visible = element => {
      const style = getComputedStyle(element)
      const rect = element.getBoundingClientRect()
      return (
        style.display !== 'none' &&
        style.visibility !== 'hidden' &&
        Number(style.opacity) !== 0 &&
        rect.width > 0 &&
        rect.height > 0
      )
    }
    const associatedLabel = element =>
      'labels' in element && element.labels
        ? [...element.labels]
            .map(candidate => candidate.textContent?.trim() ?? '')
            .join(' ')
            .trim()
        : ''
    const hasName = element =>
      Boolean(
        element.getAttribute('aria-label') ||
          element.getAttribute('aria-labelledby') ||
          element.getAttribute('title') ||
          element.getAttribute('placeholder') ||
          associatedLabel(element) ||
          element.textContent?.trim()
      )

    const dialogRect = dialog.getBoundingClientRect()
    const interactive = [
      ...dialog.querySelectorAll(
        'button, a[href], input, textarea, select, [role="button"], [role="tab"], [tabindex="0"]'
      ),
    ].filter(visible)
    const unnamed = interactive
      .filter(element => element.getAttribute('aria-hidden') !== 'true')
      .filter(element => !hasName(element))
      .map(element => element.outerHTML.slice(0, 180))

    return {
      viewport: { width: innerWidth, height: innerHeight },
      document: {
        clientWidth: document.documentElement.clientWidth,
        scrollWidth: document.documentElement.scrollWidth,
        bodyClientWidth: document.body.clientWidth,
        bodyScrollWidth: document.body.scrollWidth,
      },
      dialog: {
        left: Math.round(dialogRect.left),
        top: Math.round(dialogRect.top),
        right: Math.round(dialogRect.right),
        bottom: Math.round(dialogRect.bottom),
        width: Math.round(dialogRect.width),
        height: Math.round(dialogRect.height),
        withinViewport:
          dialogRect.left >= -1 &&
          dialogRect.top >= -1 &&
          dialogRect.right <= innerWidth + 1 &&
          dialogRect.bottom <= innerHeight + 1,
      },
      scrollRegion: {
        clientWidth: scrollRegion.clientWidth,
        scrollWidth: scrollRegion.scrollWidth,
        clientHeight: scrollRegion.clientHeight,
        scrollHeight: scrollRegion.scrollHeight,
        overflowX: getComputedStyle(scrollRegion).overflowX,
        overflowY: getComputedStyle(scrollRegion).overflowY,
      },
      interactiveCount: interactive.length,
      unnamed,
      review: dialog
        .querySelector('.add-submodule-summary')
        ?.textContent?.replace(/\s+/g, ' ')
        .trim(),
    }
  })
}

function assertReceipt(receipt, label) {
  if (
    !receipt.dialog.withinViewport ||
    receipt.document.clientWidth !== receipt.document.scrollWidth ||
    receipt.document.bodyClientWidth !== receipt.document.bodyScrollWidth ||
    receipt.scrollRegion.scrollWidth > receipt.scrollRegion.clientWidth ||
    receipt.unnamed.length > 0 ||
    !receipt.review?.includes('https://example.invalid/shared-library.git') ||
    !receipt.review.includes('vendor/shared-library') ||
    !receipt.review.includes('stable')
  ) {
    fail(
      `${label} accessibility or clipping gate failed: ${JSON.stringify(
        receipt
      )}`
    )
  }
}

async function main() {
  const options = parseArguments(process.argv.slice(2))
  const browser = await chromium.connectOverCDP(
    `http://127.0.0.1:${options.port}`
  )
  const page = await getRenderer(browser)
  const dialog = await openDialog(page)

  await assertReachable(dialog)
  await page.evaluate(() => {
    const scrollRegion = document.querySelector('.add-submodule-scroll-region')
    if (scrollRegion instanceof HTMLElement) {
      scrollRegion.scrollTop = 0
    }
  })
  await page.waitForTimeout(300)
  await page.screenshot({ path: path.resolve(options.capture) })
  const desktop = await inspect(page)
  assertReceipt(desktop, 'Desktop')

  const session = await page.context().newCDPSession(page)
  await session.send('Emulation.setDeviceMetricsOverride', {
    width: 700,
    height: 650,
    deviceScaleFactor: 1,
    mobile: false,
    screenWidth: 700,
    screenHeight: 650,
  })
  await page.waitForTimeout(300)
  await assertReachable(dialog)
  await page.evaluate(() => {
    const scrollRegion = document.querySelector('.add-submodule-scroll-region')
    if (scrollRegion instanceof HTMLElement) {
      scrollRegion.scrollTop = scrollRegion.scrollHeight
    }
  })
  await page.waitForTimeout(300)
  await page.screenshot({ path: path.resolve(options.compactCapture) })
  const compact = await inspect(page)
  assertReceipt(compact, 'Compact')
  await session.send('Emulation.clearDeviceMetricsOverride')

  process.stdout.write(`${JSON.stringify({ desktop, compact })}\n`)
  process.exit(0)
}

main().catch(error => {
  process.stderr.write(`${error.stack ?? error}\n`)
  process.exit(1)
})
