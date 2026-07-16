#!/usr/bin/env node
'use strict'

/**
 * Isolated renderer verifier for the compact Changes and Pull All milestone.
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
  const action = values.get('action')
  if (!Number.isSafeInteger(port) || port < 1 || port > 65535) {
    fail('A valid loopback CDP port is required.')
  }
  if (
    ![
      'skip-onboarding',
      'add-local',
      'close-other-tabs',
      'inspect',
      'pull-all',
    ].includes(action)
  ) {
    fail(
      'Action must be skip-onboarding, add-local, close-other-tabs, inspect, or pull-all.'
    )
  }

  const capture = values.get('capture')
  if (
    capture !== undefined &&
    !path
      .resolve(capture)
      .toLowerCase()
      .includes('desktop-material-pull-all-progress-')
  ) {
    fail('Capture must stay inside the owned Pull All verification root.')
  }

  return { port, action, capture }
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

async function inspect(page) {
  return page.evaluate(() => {
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
    const label = element =>
      element.getAttribute('aria-label') ||
      element.getAttribute('title') ||
      associatedLabel(element) ||
      element.textContent?.trim().replace(/\s+/g, ' ').slice(0, 120) ||
      element.tagName.toLowerCase()
    const interactiveSelector =
      'button, a[href], input, textarea, select, [role="button"], [role="checkbox"], [tabindex="0"]'
    const controls = [...document.querySelectorAll(interactiveSelector)].filter(
      visible
    )
    const geometry = controls.map(element => {
      const rect = element.getBoundingClientRect()
      return {
        label: label(element),
        tag: element.tagName.toLowerCase(),
        left: Math.round(rect.left),
        top: Math.round(rect.top),
        right: Math.round(rect.right),
        bottom: Math.round(rect.bottom),
        width: Math.round(rect.width),
        height: Math.round(rect.height),
      }
    })
    const outside = geometry.filter(
      item =>
        item.left < -1 ||
        item.top < -1 ||
        item.right > innerWidth + 1 ||
        item.bottom > innerHeight + 1
    )
    const unnamed = controls
      .filter(element => {
        if (element.getAttribute('aria-hidden') === 'true') {
          return false
        }
        const text = element.textContent?.trim() ?? ''
        return !(
          element.getAttribute('aria-label') ||
          element.getAttribute('aria-labelledby') ||
          element.getAttribute('title') ||
          element.getAttribute('placeholder') ||
          element.getAttribute('value') ||
          associatedLabel(element) ||
          text
        )
      })
      .map(element => element.outerHTML.slice(0, 180))
    const critical = [
      '.changes-list-container',
      '.changes-list-container .header',
      '.changes-list-container .filter-list',
      '.commit-message-component',
      '.commit-message-component .summary input',
      '.commit-message-component .description-focus-container',
      '.commit-message-component .commit-button',
      '#pull-all-repositories',
      '#pull-all-repositories .pull-all-results-container',
    ]
      .map(selector => {
        const element = document.querySelector(selector)
        if (!(element instanceof HTMLElement) || !visible(element)) {
          return null
        }
        const rect = element.getBoundingClientRect()
        const style = getComputedStyle(element)
        return {
          selector,
          left: Math.round(rect.left),
          top: Math.round(rect.top),
          right: Math.round(rect.right),
          bottom: Math.round(rect.bottom),
          width: Math.round(rect.width),
          height: Math.round(rect.height),
          overflowX: style.overflowX,
          clientWidth: element.clientWidth,
          scrollWidth: element.scrollWidth,
          clientHeight: element.clientHeight,
          scrollHeight: element.scrollHeight,
        }
      })
      .filter(Boolean)

    return {
      url: location.href,
      title: document.title,
      innerWidth,
      innerHeight,
      documentClientWidth: document.documentElement.clientWidth,
      documentScrollWidth: document.documentElement.scrollWidth,
      bodyClientWidth: document.body.clientWidth,
      bodyScrollWidth: document.body.scrollWidth,
      controlCount: controls.length,
      outside,
      unnamed,
      critical,
      visibleText: document.body.innerText.replace(/\s+/g, ' ').slice(0, 800),
    }
  })
}

async function main() {
  const options = parseArguments(process.argv.slice(2))
  const browser = await chromium.connectOverCDP(
    `http://127.0.0.1:${options.port}`
  )
  const page = await getRenderer(browser)

  if (options.action === 'skip-onboarding') {
    const skip = page.getByRole('button', {
      name: 'Continue without signing in',
    })
    if (await skip.isVisible()) {
      await skip.click()
    }
    const configureGit = page.getByRole('region', { name: 'Configure Git' })
    await configureGit.waitFor({ state: 'visible', timeout: 15_000 })
    await page.getByLabel('Name').fill('Material Fixture')
    await page.getByLabel('Email').fill('material-fixture@example.invalid')
    await page.getByRole('button', { name: 'Finish' }).click()
    await configureGit.waitFor({ state: 'hidden', timeout: 30_000 })
    await page.waitForTimeout(2_000)
  } else if (options.action === 'add-local') {
    const addRepository = page.getByRole('button', { name: 'Add repository' })
    await addRepository.waitFor({ state: 'visible', timeout: 15_000 })
    await addRepository.click()
    await addRepository.waitFor({ state: 'hidden', timeout: 30_000 })
    await page.waitForTimeout(2_000)
  } else if (options.action === 'close-other-tabs') {
    const inactiveCloseButtons = page.locator(
      '.repository-tab:not(.active) .repository-tab-close'
    )
    while ((await inactiveCloseButtons.count()) > 0) {
      await inactiveCloseButtons.first().click()
      await page.waitForTimeout(80)
    }
  } else if (options.action === 'pull-all') {
    const pullAll = page.getByRole('button', { name: /^pull all$/i })
    if (!(await pullAll.isVisible())) {
      await page.getByRole('button', { name: /current repository/i }).click()
    }
    await pullAll.waitFor({ state: 'visible', timeout: 10_000 })
    await pullAll.click()
    await page
      .getByRole('heading', { name: /all repositories processed/i })
      .waitFor({ state: 'visible', timeout: 60_000 })
  }

  await page.waitForTimeout(500)
  if (options.capture !== undefined) {
    await page.screenshot({ path: path.resolve(options.capture) })
  }
  const receipt = await inspect(page)
  const enforceGate = ['inspect', 'pull-all'].includes(options.action)
  if (
    enforceGate &&
    (receipt.documentClientWidth !== receipt.documentScrollWidth ||
      receipt.bodyClientWidth !== receipt.bodyScrollWidth ||
      receipt.outside.length > 0 ||
      receipt.unnamed.length > 0)
  ) {
    fail(`Accessibility or clipping gate failed: ${JSON.stringify(receipt)}`)
  }
  process.stdout.write(`${JSON.stringify(receipt)}\n`)
  process.exit(0)
}

main().catch(error => {
  process.stderr.write(`${error.stack ?? error}\n`)
  process.exit(1)
})
