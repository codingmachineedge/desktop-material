#!/usr/bin/env node
'use strict'

/**
 * Attach-only M21 visual verifier.
 *
 * The caller owns Electron, the hidden desktop, the synthetic repository, and
 * cleanup. This helper only drives the already-running renderer after Win32
 * background input has been attempted. It opens Repository Tools, loads the
 * exact local/remote tag inventory, checks horizontal geometry and privacy,
 * and writes one viewport-only capture below the caller-owned run root.
 */

const fs = require('fs')
const os = require('os')
const path = require('path')
const { chromium } = require('playwright')

const OwnedRootPrefix = 'desktop-material-feature-backlog-'

function fail(message) {
  throw new Error(message)
}

function isWithin(root, candidate) {
  const relative = path.relative(root, candidate)
  return (
    relative === '' ||
    (!path.isAbsolute(relative) &&
      relative !== '..' &&
      !relative.startsWith(`..${path.sep}`))
  )
}

function parseArguments(argv) {
  if (argv.length !== 10) {
    fail(
      'Usage: --port <port> --run-root <root> --capture <png> --width <px> --height <px>.'
    )
  }
  const values = new Map()
  for (let index = 0; index < argv.length; index += 2) {
    const key = argv[index]
    const value = argv[index + 1]
    if (
      !key?.startsWith('--') ||
      value === undefined ||
      values.has(key.slice(2))
    ) {
      fail(`Invalid argument near ${key ?? '<end>'}.`)
    }
    values.set(key.slice(2), value)
  }
  const allowed = new Set(['port', 'run-root', 'capture', 'width', 'height'])
  if (
    values.size !== allowed.size ||
    [...values.keys()].some(key => !allowed.has(key))
  ) {
    fail('Only port, run-root, capture, width, and height are accepted.')
  }

  const port = Number(values.get('port'))
  const width = Number(values.get('width'))
  const height = Number(values.get('height'))
  if (!Number.isSafeInteger(port) || port < 1 || port > 65535) {
    fail('A valid loopback CDP port is required.')
  }
  if (
    !Number.isSafeInteger(width) ||
    !Number.isSafeInteger(height) ||
    width < 900 ||
    width > 2000 ||
    height < 600 ||
    height > 1400
  ) {
    fail('The requested viewport is outside the bounded verification range.')
  }

  const requestedRoot = values.get('run-root')
  if (
    !path.isAbsolute(requestedRoot) ||
    !fs.statSync(requestedRoot).isDirectory()
  ) {
    fail('run-root must be an existing absolute directory.')
  }
  const runRoot = fs.realpathSync.native(requestedRoot)
  const tempRoot = fs.realpathSync.native(os.tmpdir())
  if (
    runRoot === tempRoot ||
    !isWithin(tempRoot, runRoot) ||
    !path.basename(runRoot).startsWith(OwnedRootPrefix)
  ) {
    fail('run-root must be an owned named child of the system temp directory.')
  }

  const capture = path.resolve(values.get('capture'))
  const captureRoot = path.join(runRoot, 'captures')
  if (!isWithin(captureRoot, capture) || path.extname(capture) !== '.png') {
    fail('capture must be a PNG below the owned captures directory.')
  }
  if (fs.existsSync(capture)) {
    fail('The capture target already exists.')
  }
  fs.mkdirSync(path.dirname(capture), { recursive: true })

  const fixture = path.join(runRoot, 'fixture')
  if (
    !fs.statSync(fixture).isDirectory() ||
    !fs.existsSync(path.join(fixture, '.git'))
  ) {
    fail('The owned Git fixture is missing.')
  }
  return { port, runRoot, capture, width, height }
}

async function connect(port) {
  const deadline = Date.now() + 30_000
  let lastError = null
  while (Date.now() < deadline) {
    try {
      return await chromium.connectOverCDP(`http://127.0.0.1:${port}`)
    } catch (error) {
      lastError = error
      await new Promise(resolve => setTimeout(resolve, 250))
    }
  }
  throw (
    lastError ?? new Error('The renderer CDP endpoint did not become ready.')
  )
}

async function main() {
  const options = parseArguments(process.argv.slice(2))
  const browser = await connect(options.port)
  try {
    const pages = browser.contexts().flatMap(context => context.pages())
    const page = pages.find(candidate =>
      candidate.url().includes('/out/index.html')
    )
    if (page === undefined) {
      fail('Desktop Material renderer unavailable.')
    }

    await page.setViewportSize({ width: options.width, height: options.height })
    await page.addStyleTag({
      content:
        '*,*::before,*::after{animation-duration:0s!important;transition-duration:0s!important;caret-color:transparent!important}',
    })

    const continueWithoutSignIn = page.getByRole('button', {
      name: 'Continue without signing in',
    })
    if (await continueWithoutSignIn.isVisible().catch(() => false)) {
      await continueWithoutSignIn.click()
    }

    // The isolated run inherits the already-configured synthetic Git identity.
    // ConfigureGitUser compares both prefilled fields with the current values,
    // so Finish completes onboarding without writing when they are unchanged.
    const finishGitConfiguration = page.getByRole('button', { name: 'Finish' })
    await finishGitConfiguration
      .waitFor({ state: 'visible', timeout: 10_000 })
      .catch(() => undefined)
    if (await finishGitConfiguration.isVisible().catch(() => false)) {
      await finishGitConfiguration.click()
    }

    const skip = page.locator('.first-run-checklist-skip')
    await skip
      .waitFor({ state: 'visible', timeout: 10_000 })
      .catch(() => undefined)
    if (await skip.isVisible().catch(() => false)) {
      await skip.click()
    }

    const addRepository = page.getByRole('button', { name: 'Add repository' })
    if (await addRepository.isVisible().catch(() => false)) {
      await addRepository.click()
    }

    const toolsTab = page.locator('#repository-tools-tab')
    await toolsTab.waitFor({ state: 'visible', timeout: 60_000 })
    await toolsTab.click()
    const sidebar = page.locator('.repository-tools-sidebar')
    await sidebar.waitFor({ state: 'visible', timeout: 30_000 })

    const search = sidebar.locator('.repository-tools-search-input')
    await search.fill('Tag lifecycle')
    const tagEntry = sidebar.locator('[data-hub-tool="tag-lifecycle"]')
    await tagEntry.waitFor({ state: 'visible', timeout: 10_000 })
    await tagEntry.click()

    const manager = page.locator('.tag-lifecycle-manager')
    await manager.waitFor({ state: 'visible', timeout: 30_000 })
    await manager.getByRole('heading', { name: /Local tags/ }).waitFor({
      state: 'visible',
      timeout: 30_000,
    })
    const loadRemote = manager.getByRole('button', { name: 'Load remote' })
    await page.waitForFunction(() => {
      const buttons = [
        ...document.querySelectorAll('.tag-lifecycle-manager button'),
      ]
      const button = buttons.find(
        candidate => candidate.textContent?.trim() === 'Load remote'
      )
      return button instanceof HTMLButtonElement && !button.disabled
    })
    await loadRemote.click()
    const remoteHeading = manager.getByRole('heading', {
      name: /Remote-only tags/,
    })
    await remoteHeading.waitFor({
      state: 'visible',
      timeout: 30_000,
    })
    await remoteHeading.scrollIntoViewIfNeeded()

    const introduction = page.locator('.repository-tools-introduction')
    if (await introduction.isVisible().catch(() => false)) {
      await introduction.evaluate(element => {
        element.textContent =
          'Status, history, cleanup, transfer, and repair tools for the synthetic fixture — every function runs a reviewed Git recipe with no shell or editable command line.'
      })
    }

    const receipt = await page.evaluate(runRoot => {
      const visibleText = document.body.innerText
      const manager = document.querySelector('.tag-lifecycle-manager')
      const sidebar = document.querySelector('.repository-tools-sidebar')
      if (
        !(manager instanceof HTMLElement) ||
        !(sidebar instanceof HTMLElement)
      ) {
        throw new Error('The advanced workflow surfaces disappeared.')
      }
      const managerRect = manager.getBoundingClientRect()
      const sidebarRect = sidebar.getBoundingClientRect()
      const horizontalOverflow =
        document.documentElement.scrollWidth >
          document.documentElement.clientWidth + 1 ||
        document.body.scrollWidth > document.body.clientWidth + 1 ||
        manager.scrollWidth > manager.clientWidth + 1 ||
        sidebar.scrollWidth > sidebar.clientWidth + 1
      const leakedPath =
        visibleText.includes(runRoot) ||
        /C:\\Users\\[^\s]+/i.test(visibleText) ||
        /AppData\\Local\\Temp/i.test(visibleText)
      return {
        title: document.title,
        languageMode:
          document.body.getAttribute('data-dm-language-mode') ?? 'unknown',
        horizontalOverflow,
        leakedPath,
        managerRect: {
          left: managerRect.left,
          right: managerRect.right,
          width: managerRect.width,
        },
        sidebarRect: {
          left: sidebarRect.left,
          right: sidebarRect.right,
          width: sidebarRect.width,
        },
        localHeading:
          [...manager.querySelectorAll('h3')]
            .map(value => value.textContent?.trim() ?? '')
            .find(value => value.startsWith('Local tags')) ?? null,
        remoteHeading:
          [...manager.querySelectorAll('h3')]
            .map(value => value.textContent?.trim() ?? '')
            .find(value => value.startsWith('Remote-only tags')) ?? null,
      }
    }, options.runRoot)
    if (
      receipt.horizontalOverflow ||
      receipt.leakedPath ||
      receipt.languageMode !== 'english'
    ) {
      fail(
        'The advanced workflow frame failed language, geometry, or privacy checks.'
      )
    }

    await page.evaluate(() => document.fonts.ready)
    await page.waitForTimeout(250)
    const session = await page.context().newCDPSession(page)
    const screenshot = await session.send('Page.captureScreenshot', {
      format: 'png',
      fromSurface: true,
      captureBeyondViewport: false,
    })
    fs.writeFileSync(options.capture, Buffer.from(screenshot.data, 'base64'), {
      flag: 'wx',
    })
    const stat = fs.statSync(options.capture)
    process.stdout.write(
      `${JSON.stringify({
        status: 'passed',
        viewport: { width: options.width, height: options.height },
        capture: { file: path.basename(options.capture), bytes: stat.size },
        ...receipt,
      })}\n`
    )
  } finally {
    await browser.close()
  }
}

main().catch(error => {
  process.stderr.write(`${error.stack ?? error.message}\n`)
  process.exitCode = 1
})
