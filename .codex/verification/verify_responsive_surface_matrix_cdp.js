#!/usr/bin/env node
/* eslint-disable no-sync -- every synchronous path is bounded to the validated disposable run root */

/*
 * Exhaustive responsive-surface verifier for Desktop Material. The caller owns
 * the exact production build, Electron process, loopback CDP port, isolated
 * user-data/repository fixture, off-screen Win32 desktop, and cleanup. This
 * helper expects seed_batch_clone_recovery_fixture.js to have populated the
 * isolated userData directory before launch, prepares one deterministic File
 * History probe, drives the already-running renderer, and writes evidence
 * inside the caller-owned run root.
 */

const crypto = require('crypto')
const { execFileSync } = require('child_process')
const fs = require('fs')
const os = require('os')
const path = require('path')
const { chromium } = require('playwright')
const {
  FixtureItemCount: BatchCloneRecoveryFixtureItemCount,
} = require('./seed_batch_clone_recovery_fixture')

// On Windows, fs.realpathSync can preserve an 8.3 spelling for os.tmpdir()
// while expanding a caller-supplied child path. The native variant returns a
// consistent long-path spelling, keeping the containment gate strict without
// rejecting the same directory under two equivalent names.
const realpathSync = fs.realpathSync.native ?? fs.realpathSync
const nonModalDialogSelector = '[role="dialog"][aria-modal="false"]'

const catalog = JSON.parse(
  fs.readFileSync(
    path.join(__dirname, 'responsive_surface_catalog.json'),
    'utf8'
  )
)

function fail(message) {
  throw new Error(message)
}

function isWithin(root, candidate, allowRoot = false) {
  const relative = path.relative(root, candidate)
  return (
    (allowRoot || relative.length > 0) &&
    !relative.startsWith('..') &&
    !path.isAbsolute(relative)
  )
}

function parseArguments(argv) {
  const values = new Map()
  const allowed = new Set([
    'port',
    'run-root',
    'repository-path',
    'ledger',
    'capture-directory',
  ])
  for (let index = 0; index < argv.length; index += 2) {
    const name = argv[index]
    const value = argv[index + 1]
    if (!name?.startsWith('--') || value === undefined) {
      fail(`Invalid argument near ${name ?? '<end>'}.`)
    }
    const key = name.slice(2)
    if (!allowed.has(key)) {
      fail(`Unknown argument ${name}.`)
    }
    if (values.has(key)) {
      fail(`Duplicate argument ${name}.`)
    }
    values.set(key, value)
  }

  const port = Number(values.get('port'))
  if (!Number.isSafeInteger(port) || port < 1 || port > 65535) {
    fail('A valid loopback CDP port is required.')
  }

  const requestedRunRoot = path.resolve(values.get('run-root') ?? '')
  if (
    !fs.existsSync(requestedRunRoot) ||
    !fs.statSync(requestedRunRoot).isDirectory()
  ) {
    fail('The owned run root must be an existing directory.')
  }
  const runRoot = realpathSync(requestedRunRoot)
  const tempRoot = realpathSync(path.resolve(os.tmpdir()))
  if (
    !path.basename(runRoot).startsWith('desktop-material-p0-ui-') ||
    !isWithin(tempRoot, runRoot)
  ) {
    fail('The owned run root must be a named child of the system Temp root.')
  }
  const repositoryValue = values.get('repository-path')
  if (repositoryValue === undefined) {
    fail('repository-path is required.')
  }
  const requestedRepositoryPath = path.resolve(repositoryValue)
  if (
    !fs.existsSync(requestedRepositoryPath) ||
    !fs.statSync(requestedRepositoryPath).isDirectory()
  ) {
    fail('The deterministic repository fixture does not exist.')
  }
  const repositoryPath = realpathSync(requestedRepositoryPath)
  if (
    !isWithin(runRoot, repositoryPath) ||
    !fs.existsSync(path.join(repositoryPath, '.git')) ||
    !fs.statSync(path.join(repositoryPath, '.git')).isDirectory()
  ) {
    fail(
      'The deterministic repository fixture must remain inside the run root.'
    )
  }

  const resolveNewOutput = (name, directory) => {
    const value = values.get(name)
    if (value === undefined) {
      fail(`${name} is required.`)
    }
    const resolved = path.resolve(value)
    if (!isWithin(runRoot, resolved)) {
      fail(`${name} must remain inside the owned run root.`)
    }
    if (directory) {
      if (!fs.existsSync(resolved) || !fs.statSync(resolved).isDirectory()) {
        fail(`${name} must be an existing directory.`)
      }
      const realDirectory = realpathSync(resolved)
      if (!isWithin(runRoot, realDirectory, true)) {
        fail(`${name} resolves outside the owned run root.`)
      }
      return realDirectory
    } else if (fs.existsSync(resolved)) {
      fail(`${name} must be a new file.`)
    }
    const parent = path.dirname(resolved)
    if (!fs.existsSync(parent) || !fs.statSync(parent).isDirectory()) {
      fail(`${name} parent must be an existing directory.`)
    }
    const realParent = realpathSync(parent)
    if (!isWithin(runRoot, realParent, true)) {
      fail(`${name} parent resolves outside the owned run root.`)
    }
    return path.join(realParent, path.basename(resolved))
  }

  return {
    port,
    runRoot,
    repositoryPath,
    ledgerPath: resolveNewOutput('ledger', false),
    captureDirectory: resolveNewOutput('capture-directory', true),
  }
}

function prepareFileHistoryFixture(repositoryPath) {
  const fileName = 'responsive-file-history-probe.txt'
  const filePath = path.join(repositoryPath, fileName)
  const git = args =>
    execFileSync('git', ['-C', repositoryPath, ...args], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    })

  const baseline = 'Desktop Material responsive history baseline.\n'
  const workingCopy = `${baseline}Uncommitted line used to open History and Line blame safely.\n`
  if (fs.existsSync(filePath)) {
    const content = fs.readFileSync(filePath, 'utf8')
    const status = git(['status', '--porcelain=v1', '--', fileName]).trimEnd()
    const provenance = git([
      'log',
      '-1',
      '--format=%an%x00%ae%x00%s',
      '--',
      fileName,
    ]).trimEnd()
    if (
      content !== workingCopy ||
      !/^ M responsive-file-history-probe\.txt$/.test(status) ||
      provenance !==
        'Material Responsive Verifier\u0000material-responsive@example.invalid\u0000Add responsive File History probe'
    ) {
      fail(`An unrelated File History probe already exists: ${fileName}.`)
    }
    return fileName
  }

  fs.writeFileSync(filePath, baseline, { encoding: 'utf8', flag: 'wx' })
  git(['add', '--', fileName])
  git([
    '-c',
    'user.name=Material Responsive Verifier',
    '-c',
    'user.email=material-responsive@example.invalid',
    'commit',
    '--quiet',
    '-m',
    'Add responsive File History probe',
    '--',
    fileName,
  ])
  fs.appendFileSync(filePath, workingCopy.slice(baseline.length), 'utf8')

  const status = git(['status', '--porcelain=v1', '--', fileName]).trimEnd()
  if (!/^ M responsive-file-history-probe\.txt$/.test(status)) {
    fail(`The File History probe was not modified as expected: ${status}.`)
  }
  return fileName
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

async function settle(page, delay = 350) {
  await page.waitForTimeout(delay)
  await page.locator('#window-zoom-info').waitFor({
    state: 'detached',
    timeout: 5_000,
  })
}

async function emitMenuEvent(page, name) {
  await page.evaluate(value => {
    require('electron').ipcRenderer.emit('menu-event', {}, value)
  }, name)
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
    if (!(await add.isEnabled())) {
      fail('The deterministic repository was not selectable.')
    }
    await add.click()
    await addHeading.waitFor({ state: 'detached', timeout: 30_000 })
  }

  await history.waitFor({ state: 'visible', timeout: 30_000 })
  await settle(page)
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
  const metrics = await page.evaluate(() => {
    const zoomFactor = require('electron').webFrame.getZoomFactor()
    return {
      innerWidth,
      innerHeight,
      devicePixelRatio,
      zoomFactor,
      physicalClientWidth: Math.round(innerWidth * devicePixelRatio),
      physicalClientHeight: Math.round(innerHeight * devicePixelRatio),
      visualViewport:
        window.visualViewport === null
          ? null
          : {
              width: Math.round(window.visualViewport.width),
              height: Math.round(window.visualViewport.height),
              scale: window.visualViewport.scale,
            },
    }
  })
  if (
    Math.abs(metrics.zoomFactor - scenario.zoom) > 0.001 ||
    Math.abs(metrics.physicalClientWidth - scenario.width) > 2 ||
    Math.abs(metrics.physicalClientHeight - scenario.height) > 2
  ) {
    fail(
      `Responsive metrics were not applied for ${scenario.id}: ${JSON.stringify(
        { scenario, metrics }
      )}`
    )
  }
  return metrics
}

async function restoreMetrics(page, session) {
  await page.evaluate(() => require('electron').webFrame.setZoomFactor(1))
  await session.send('Emulation.clearDeviceMetricsOverride')
  await settle(page)
}

async function inspectSurface(page, selector, targetSelector = null) {
  return page.evaluate(
    ({ rootSelector, requiredTargetSelector }) => {
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
      const candidates = [...document.querySelectorAll(rootSelector)].filter(
        element => element instanceof HTMLElement && visible(element)
      )
      const root = candidates.at(-1)
      if (!(root instanceof HTMLElement)) {
        return null
      }

      const target =
        requiredTargetSelector === null
          ? root
          : [...root.querySelectorAll(requiredTargetSelector)]
              .filter(
                element => element instanceof HTMLElement && visible(element)
              )
              .at(-1) ?? null
      const controlRoot = target ?? root

      const scrollOwners = [root, ...root.querySelectorAll('*')].filter(
        element => {
          if (!(element instanceof HTMLElement) || !visible(element)) {
            return false
          }
          const overflowY = getComputedStyle(element).overflowY
          return (
            element.scrollHeight > element.clientHeight + 1 &&
            (overflowY === 'auto' || overflowY === 'scroll')
          )
        }
      )
      for (const owner of scrollOwners) {
        owner.scrollTop = owner.scrollHeight
      }
      // Record the bottom proof before bringing the final control into view.
      // A surface can own several independent scroll regions, and scrolling the
      // final control in one must not invalidate the proof already collected for
      // another.
      const scrollOwnerReceipts = scrollOwners.map(owner => ({
        label:
          owner.id ||
          [...owner.classList].slice(0, 3).join('.') ||
          owner.tagName.toLowerCase(),
        clientHeight: owner.clientHeight,
        scrollHeight: owner.scrollHeight,
        scrollTop: owner.scrollTop,
        maxScrollTop: owner.scrollHeight - owner.clientHeight,
        reachedBottom:
          Math.abs(
            owner.scrollTop - (owner.scrollHeight - owner.clientHeight)
          ) <= 2,
      }))

      const rootBounds = root.getBoundingClientRect()
      const controls = [
        ...controlRoot.querySelectorAll(
          'button:not([disabled]), input:not([type="hidden"]):not([disabled]), select:not([disabled]), textarea:not([disabled]), a[href], [tabindex]:not([tabindex="-1"])'
        ),
      ].filter(
        element =>
          element instanceof HTMLElement &&
          element.getAttribute('aria-hidden') !== 'true' &&
          // React Virtualized grids are focusable scroll surfaces, not final
          // action controls. Their full rectangle may intentionally exceed a
          // compact clipped viewport; their separate scroll-owner receipt
          // proves bottom reachability instead.
          !element.classList.contains('ReactVirtualized__Grid') &&
          // Split-pane resize separators span adjacent surfaces and are not a
          // terminal action within either pane. Their large hit rectangle can
          // legitimately cross the audited root at compact sizes.
          !element.classList.contains('resize-handle') &&
          visible(element) &&
          (() => {
            // A focusable virtualized diff/list row can remain mounted outside
            // an ancestor's clipped scrollport. It is not a currently reachable
            // final control until its owner brings it into the surface.
            const rect = element.getBoundingClientRect()
            return (
              rect.right > rootBounds.left + 1 &&
              rect.left < rootBounds.right - 1 &&
              rect.bottom > rootBounds.top + 1 &&
              rect.top < rootBounds.bottom - 1
            )
          })()
      )
      const lastControl = controls.at(-1)
      lastControl?.scrollIntoView({ block: 'nearest', inline: 'nearest' })

      const unnamedButtons = [...root.querySelectorAll('button')]
        .filter(
          element =>
            element instanceof HTMLButtonElement &&
            element.getAttribute('aria-hidden') !== 'true' &&
            visible(element)
        )
        .filter(element => {
          const labelledBy = element.getAttribute('aria-labelledby')
          const labelledText =
            labelledBy === null
              ? ''
              : labelledBy
                  .split(/\s+/)
                  .map(id => document.getElementById(id)?.textContent ?? '')
                  .join(' ')
          const descendantLabel = element
            .querySelector('[aria-label]:not([aria-hidden="true"])')
            ?.getAttribute('aria-label')
          return ![
            element.getAttribute('aria-label'),
            labelledText,
            descendantLabel,
            element.innerText,
            element.textContent,
          ].some(value => (value ?? '').replace(/\s+/g, ' ').trim().length > 0)
        })
        .map(element => element.outerHTML.slice(0, 180))

      const roundedRect = element => {
        if (!(element instanceof HTMLElement)) {
          return null
        }
        const rect = element.getBoundingClientRect()
        return {
          left: Math.round(rect.left),
          top: Math.round(rect.top),
          right: Math.round(rect.right),
          bottom: Math.round(rect.bottom),
          withinViewport:
            rect.left >= -1 &&
            rect.top >= -1 &&
            rect.right <= innerWidth + 1 &&
            rect.bottom <= innerHeight + 1,
          withinViewportHorizontally:
            rect.left >= -1 && rect.right <= innerWidth + 1,
        }
      }
      const rootRect = rootBounds
      const targetRect = target?.getBoundingClientRect()
      const lastRect = lastControl?.getBoundingClientRect()
      const footer = root.querySelector('.dialog-footer')
      const form = root.querySelector(':scope > form')
      const fieldset = form?.querySelector(':scope > fieldset')
      const decorativeOverlays = [
        ...root.querySelectorAll('canvas, [role="tooltip"]'),
      ].filter(element => {
        if (!(element instanceof HTMLElement) || !visible(element)) {
          return false
        }
        const style = getComputedStyle(element)
        const floating =
          style.position === 'absolute' || style.position === 'fixed'
        return (
          floating &&
          ((element instanceof HTMLCanvasElement &&
            style.pointerEvents === 'none') ||
            element.getAttribute('role') === 'tooltip')
        )
      })
      const measureLayout = () => ({
        document: {
          clientWidth: document.documentElement.clientWidth,
          scrollWidth: document.documentElement.scrollWidth,
          bodyClientWidth: document.body.clientWidth,
          bodyScrollWidth: document.body.scrollWidth,
        },
        root: {
          clientWidth: root.clientWidth,
          scrollWidth: root.scrollWidth,
          clientHeight: root.clientHeight,
          scrollHeight: root.scrollHeight,
        },
        target:
          target instanceof HTMLElement
            ? {
                clientWidth: target.clientWidth,
                scrollWidth: target.scrollWidth,
                clientHeight: target.clientHeight,
                scrollHeight: target.scrollHeight,
              }
            : null,
      })
      const rawLayout = measureLayout()
      const structuralLayout = (() => {
        if (decorativeOverlays.length === 0) {
          return rawLayout
        }
        const display = decorativeOverlays.map(element => ({
          element,
          value: element.style.getPropertyValue('display'),
          priority: element.style.getPropertyPriority('display'),
        }))
        try {
          for (const entry of display) {
            entry.element.style.setProperty('display', 'none', 'important')
          }
          return measureLayout()
        } finally {
          for (const entry of display) {
            if (entry.value.length === 0) {
              entry.element.style.removeProperty('display')
            } else {
              entry.element.style.setProperty(
                'display',
                entry.value,
                entry.priority
              )
            }
          }
        }
      })()
      const label = element =>
        element?.getAttribute('aria-label') ??
        element?.textContent?.replace(/\s+/g, ' ').trim().slice(0, 120) ??
        null
      const verticalOverflowTraps = [...new Set([root, target])]
        .filter(element => element instanceof HTMLElement)
        .filter(element => {
          const dimensions =
            element === root ? structuralLayout.root : structuralLayout.target
          return (
            dimensions !== null &&
            dimensions.scrollHeight > dimensions.clientHeight + 1
          )
        })
        // Composite dialogs and master/detail pages deliberately clip their
        // outer shell while delegating scrolling to a contained region. That
        // is only safe when the contained region is a real user-scroll owner;
        // those owners were driven to—and receipted at—their bottom above.
        .filter(
          element =>
            !scrollOwners.some(
              owner => owner !== element && element.contains(owner)
            )
        )
        .filter(element => {
          const overflowY = getComputedStyle(element).overflowY
          return overflowY !== 'auto' && overflowY !== 'scroll'
        })
        .map(element => {
          const dimensions =
            element === root ? structuralLayout.root : structuralLayout.target
          return {
            label: label(element) ?? element.tagName.toLowerCase(),
            clientHeight: dimensions?.clientHeight ?? element.clientHeight,
            scrollHeight: dimensions?.scrollHeight ?? element.scrollHeight,
            overflowY: getComputedStyle(element).overflowY,
          }
        })

      return {
        viewport: { width: innerWidth, height: innerHeight },
        document: {
          ...structuralLayout.document,
          rawScrollWidth: rawLayout.document.scrollWidth,
          rawBodyScrollWidth: rawLayout.document.bodyScrollWidth,
        },
        root: {
          ...roundedRect(root),
          ...structuralLayout.root,
          rawScrollWidth: rawLayout.root.scrollWidth,
          rawScrollHeight: rawLayout.root.scrollHeight,
          overflowX: getComputedStyle(root).overflowX,
          overflowY: getComputedStyle(root).overflowY,
        },
        target:
          target instanceof HTMLElement && targetRect !== undefined
            ? {
                selector: requiredTargetSelector,
                ...roundedRect(target),
                ...structuralLayout.target,
                rawScrollWidth: rawLayout.target?.scrollWidth,
                rawScrollHeight: rawLayout.target?.scrollHeight,
                overflowX: getComputedStyle(target).overflowX,
                overflowY: getComputedStyle(target).overflowY,
                withinRootHorizontally:
                  targetRect.left >= rootRect.left - 1 &&
                  targetRect.right <= rootRect.right + 1,
              }
            : null,
        scrollOwners: scrollOwnerReceipts,
        verticalOverflowTraps,
        lastControl:
          lastControl instanceof HTMLElement && lastRect !== undefined
            ? {
                label: label(lastControl),
                ...roundedRect(lastControl),
                withinRoot:
                  lastRect.left >= rootRect.left - 1 &&
                  lastRect.top >= rootRect.top - 1 &&
                  lastRect.right <= rootRect.right + 1 &&
                  lastRect.bottom <= rootRect.bottom + 1,
              }
            : null,
        footer: roundedRect(footer),
        form: roundedRect(form),
        fieldset: roundedRect(fieldset),
        decorativeOverlays: decorativeOverlays.map(element => ({
          tag: element.tagName.toLowerCase(),
          position: getComputedStyle(element).position,
          pointerEvents: getComputedStyle(element).pointerEvents,
        })),
        unnamedButtons,
      }
    },
    { rootSelector: selector, requiredTargetSelector: targetSelector }
  )
}

function assertSurface(receipt, label) {
  const problems = []
  if (receipt === null) {
    problems.push('surface missing')
  } else {
    if (
      receipt.document.scrollWidth > receipt.document.clientWidth + 1 ||
      receipt.document.bodyScrollWidth > receipt.document.bodyClientWidth + 1
    ) {
      problems.push('document horizontal overflow')
    }
    if (!receipt.root.withinViewport) {
      problems.push('surface outside viewport')
    }
    if (receipt.root.scrollWidth > receipt.root.clientWidth + 1) {
      problems.push('surface horizontal overflow')
    }
    if (receipt.target === null) {
      problems.push('required nested surface missing')
    } else {
      if (
        !receipt.target.withinViewportHorizontally ||
        !receipt.target.withinRootHorizontally
      ) {
        problems.push('nested surface horizontally clipped')
      }
      if (receipt.target.scrollWidth > receipt.target.clientWidth + 1) {
        problems.push('nested surface horizontal overflow')
      }
    }
    if (receipt.scrollOwners.some(owner => !owner.reachedBottom)) {
      problems.push('scroll owner could not reach bottom')
    }
    if (receipt.verticalOverflowTraps.length > 0) {
      problems.push('vertical overflow has no user-scrollable owner')
    }
    if (
      receipt.lastControl !== null &&
      (!receipt.lastControl.withinViewport || !receipt.lastControl.withinRoot)
    ) {
      problems.push('last control unreachable')
    }
    if (receipt.form !== null && !receipt.form.withinViewport) {
      problems.push('dialog form outside viewport')
    }
    // Chromium fieldsets report geometry through an anonymous internal box,
    // and footer padding can extend into a clipped paint area even when every
    // actionable control is inside the dialog. Reachability is proved by the
    // user-scrollable owners plus lastControl/form containment above; retain
    // footer/fieldset rectangles in the receipt for visual triage without
    // turning those non-actionable boxes into false gate failures.
    if (receipt.unnamedButtons.length > 0) {
      problems.push('button without a hint/accessibility name')
    }
  }
  if (problems.length > 0) {
    fail(`${label}: ${problems.join(', ')}: ${JSON.stringify(receipt)}`)
  }
}

function captureName(id) {
  return `${id.replace(/[^a-z0-9.-]+/gi, '-').toLowerCase()}.png`
}

function sha256(file) {
  return crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex')
}

async function auditMatrix(
  page,
  session,
  options,
  id,
  selector,
  targetSelector = null,
  assertReceipt = assertSurface
) {
  const evidence = []
  let capture = null
  try {
    for (const scenario of catalog.viewportMatrix) {
      const metrics = await setMetrics(page, session, scenario)
      const receipt = await inspectSurface(page, selector, targetSelector)
      assertReceipt(receipt, `${id}/${scenario.id}`)
      evidence.push({ scenario, metrics, receipt })
      if (scenario.id === 'short') {
        const capturePath = path.join(options.captureDirectory, captureName(id))
        if (fs.existsSync(capturePath)) {
          fail(`Duplicate capture target for ${id}.`)
        }
        await page.screenshot({ path: capturePath })
        capture = {
          path: path.relative(options.runRoot, capturePath).replace(/\\/g, '/'),
          sha256: sha256(capturePath),
          width: scenario.width,
          height: scenario.height,
          zoom: scenario.zoom,
        }
      }
    }
  } finally {
    await restoreMetrics(page, session)
  }
  return { id, status: 'pass', evidence, capture }
}

function assertBatchCloneRecoverySurface(receipt, label) {
  assertSurface(receipt, label)
  const cloneList = receipt.scrollOwners.find(owner =>
    owner.label.split('.').includes('batch-clone-list')
  )
  if (cloneList === undefined || !cloneList.reachedBottom) {
    fail(`${label}: clone queue list did not expose a reachable bottom.`)
  }
  if (receipt.lastControl?.label !== 'Hide') {
    fail(`${label}: Hide was not the final reachable control.`)
  }
}

async function auditBatchCloneRecoveryPopup(page, session, options, ledger) {
  const id = 'popup.batch-clone-recovery'
  const dialog = page.locator('dialog#batch-clone-progress')
  let row = null
  try {
    await dialog.waitFor({ state: 'visible', timeout: 30_000 })
    const fixtureState = await dialog.evaluate(root => {
      const items = [...root.querySelectorAll('.batch-clone-item')]
      const title = root.querySelector('h1, h2, header')?.textContent ?? ''
      const summary = root.querySelector(
        '.batch-clone-overall .summary'
      )?.textContent
      const buttons = [...root.querySelectorAll('button')]
      const findButton = label =>
        buttons.find(
          button => button.textContent?.replace(/\s+/g, ' ').trim() === label
        )
      const resume = findButton('Resume')
      return {
        title: title.replace(/\s+/g, ' ').trim(),
        summary: summary?.replace(/\s+/g, ' ').trim() ?? '',
        itemCount: items.length,
        interruptedCount: items.filter(item =>
          item.classList.contains('interrupted')
        ).length,
        resumeEnabled: resume instanceof HTMLButtonElement && !resume.disabled,
        hidePresent: findButton('Hide') instanceof HTMLButtonElement,
      }
    })
    if (
      fixtureState.title !== 'Clone queue paused' ||
      fixtureState.itemCount !== BatchCloneRecoveryFixtureItemCount ||
      fixtureState.interruptedCount !== fixtureState.itemCount ||
      !fixtureState.resumeEnabled ||
      !fixtureState.hidePresent ||
      !fixtureState.summary.includes(`${fixtureState.itemCount} interrupted`)
    ) {
      fail(
        `The initial clone recovery popup was not the paused/interrupted fixture: ${JSON.stringify(
          fixtureState
        )}`
      )
    }

    const matrixRow = await auditMatrix(
      page,
      session,
      options,
      id,
      '#batch-clone-progress',
      null,
      assertBatchCloneRecoverySurface
    )
    row = { ...matrixRow, fixtureState }

    const hide = dialog.getByRole('button', { name: 'Hide', exact: true })
    await hide.click()
    await dialog.waitFor({ state: 'hidden', timeout: 10_000 })
    await settle(page)
  } catch (error) {
    row = {
      id,
      status: 'failed',
      evidence: [],
      capture: null,
      notes: error instanceof Error ? error.message : String(error),
    }
    if (await dialog.isVisible().catch(() => false)) {
      const hide = dialog.getByRole('button', { name: 'Hide', exact: true })
      if ((await hide.count()) > 0 && (await hide.isVisible())) {
        await hide.click().catch(() => undefined)
        await dialog
          .waitFor({ state: 'hidden', timeout: 10_000 })
          .catch(() => undefined)
        await settle(page).catch(() => undefined)
      }
    }
  }
  ledger.push(row)
}

async function safeAuditMatrix(
  page,
  session,
  options,
  id,
  selector,
  targetSelector = null
) {
  try {
    return await auditMatrix(
      page,
      session,
      options,
      id,
      selector,
      targetSelector
    )
  } catch (error) {
    return {
      id,
      status: 'failed',
      evidence: [],
      capture: null,
      notes: error instanceof Error ? error.message : String(error),
    }
  }
}

async function visibleTab(scope, label, fallbackSelector = null) {
  const locator = scope.getByRole('tab', { name: label, exact: true })
  for (let index = 0; index < (await locator.count()); index++) {
    const candidate = locator.nth(index)
    if (await candidate.isVisible()) {
      return candidate
    }
  }

  if (fallbackSelector !== null) {
    const markers = scope.locator(fallbackSelector)
    for (let index = 0; index < (await markers.count()); index++) {
      const candidate = markers.nth(index).locator('xpath=..')
      if (
        (await candidate.getAttribute('role')) === 'tab' &&
        (await candidate.isVisible())
      ) {
        return candidate
      }
    }
  }
  return null
}

async function auditRepositorySections(page, session, options, ledger) {
  for (const surface of catalog.surfaceGroups.repositorySections.surfaces) {
    const tab = await visibleTab(
      page,
      surface.label,
      surface.member === 'Changes'
        ? '#changes-tab'
        : surface.member === 'History'
        ? '#history-tab'
        : null
    )
    if (tab === null) {
      ledger.push({
        id: `repository.${surface.member}`,
        status: surface.conditional ? 'not-applicable' : 'blocked',
        notes:
          'The deterministic fixture did not expose this conditional rail page.',
      })
      continue
    }
    await tab.click()
    await settle(page)
    ledger.push(
      await safeAuditMatrix(
        page,
        session,
        options,
        `repository.${surface.member}`,
        '#repository'
      )
    )

    if (surface.member === 'GitHubAPI') {
      const explorer = page.locator('.github-api-explorer')
      for (const nested of catalog.nestedSurfaces.filter(
        item => item.id.startsWith('repository.api.') && item.kind === 'tab'
      )) {
        const nestedTab = await visibleTab(explorer, nested.label)
        if (nestedTab === null) {
          ledger.push({ id: nested.id, status: 'blocked' })
          continue
        }
        await nestedTab.click()
        await settle(page)
        ledger.push(
          await safeAuditMatrix(
            page,
            session,
            options,
            nested.id,
            '.github-api-explorer'
          )
        )
      }

      const functions = catalog.nestedSurfaces.find(
        item => item.id === 'repository.api.functions'
      )
      if (functions !== undefined) {
        ledger.push(
          await safeAuditMatrix(
            page,
            session,
            options,
            functions.id,
            functions.ownerSelector,
            functions.selector
          )
        )
      }
    }
  }
}

async function closeTopDialog(page) {
  while (true) {
    const panels = page.locator(nonModalDialogSelector)
    let panel = null
    for (let index = (await panels.count()) - 1; index >= 0; index--) {
      const candidate = panels.nth(index)
      if (await candidate.isVisible()) {
        panel = candidate
        break
      }
    }
    if (panel === null) {
      break
    }
    const before = await visibleNonModalDialogCount(page)
    const close = panel.getByRole('button', { name: /^Close\b/ }).first()
    if ((await close.count()) > 0 && (await close.isVisible())) {
      await close.click()
    } else {
      await page.keyboard.press('Escape')
    }
    await page.waitForFunction(
      ({ selector, expected }) =>
        [...document.querySelectorAll(selector)].filter(element => {
          const rect = element.getBoundingClientRect()
          const style = getComputedStyle(element)
          return (
            style.display !== 'none' &&
            style.visibility !== 'hidden' &&
            rect.width > 0 &&
            rect.height > 0
          )
        }).length < expected,
      { selector: nonModalDialogSelector, expected: before },
      { timeout: 8_000 }
    )
    await settle(page)
  }

  const open = page.locator('#dialog-layer dialog[open]')
  const before = await open.count()
  if (before === 0) {
    return
  }
  await settle(page, 450)
  const top = page.locator('#dialog-layer dialog[open][data-top-most]').last()
  const close = top.getByRole('button', { name: 'Close', exact: true }).first()
  if ((await close.count()) > 0 && (await close.isVisible())) {
    await close.click()
  } else {
    await page.keyboard.press('Escape')
  }
  await page.waitForFunction(
    expected =>
      document.querySelectorAll('#dialog-layer dialog[open]').length < expected,
    before,
    { timeout: 8_000 }
  )
  await settle(page)
}

async function visibleNonModalDialogCount(page) {
  return page.locator(nonModalDialogSelector).evaluateAll(
    elements =>
      elements.filter(element => {
        const rect = element.getBoundingClientRect()
        const style = getComputedStyle(element)
        return (
          style.display !== 'none' &&
          style.visibility !== 'hidden' &&
          rect.width > 0 &&
          rect.height > 0
        )
      }).length
  )
}

async function auditPreferences(page, session, options, ledger) {
  await emitMenuEvent(page, 'show-preferences')
  const dialog = page.locator('#preferences')
  await dialog.waitFor({ state: 'visible', timeout: 10_000 })

  for (const surface of catalog.surfaceGroups.preferences.surfaces) {
    const tab = await visibleTab(dialog, surface.label)
    if (tab === null) {
      ledger.push({
        id: `preferences.${surface.member}`,
        status: surface.conditional ? 'not-applicable' : 'blocked',
      })
      continue
    }
    await tab.click()
    await settle(page)
    ledger.push(
      await safeAuditMatrix(
        page,
        session,
        options,
        `preferences.${surface.member}`,
        '#preferences'
      )
    )

    const prefix =
      surface.member === 'Git'
        ? 'preferences.git.'
        : surface.member === 'Copilot'
        ? 'preferences.copilot.'
        : null
    if (prefix !== null) {
      for (const nested of catalog.nestedSurfaces.filter(item =>
        item.id.startsWith(prefix)
      )) {
        const nestedTab = await visibleTab(dialog, nested.label)
        if (nestedTab === null) {
          ledger.push({
            id: nested.id,
            status: nested.conditional ? 'not-applicable' : 'blocked',
          })
          continue
        }
        await nestedTab.click()
        await settle(page)
        ledger.push(
          await safeAuditMatrix(
            page,
            session,
            options,
            nested.id,
            '#preferences'
          )
        )
      }
    }

    if (surface.member === 'Appearance') {
      const studio = catalog.nestedSurfaces.find(
        item => item.id === 'preferences.appearance.logo-studio'
      )
      if (studio !== undefined) {
        ledger.push(
          await safeAuditMatrix(
            page,
            session,
            options,
            studio.id,
            studio.ownerSelector,
            studio.selector
          )
        )
      }
    }
  }
  await closeTopDialog(page)
}

async function auditRepositorySettings(page, session, options, ledger) {
  await emitMenuEvent(page, 'show-repository-settings')
  const dialog = page.locator('#repository-settings')
  await dialog.waitFor({ state: 'visible', timeout: 10_000 })
  for (const surface of catalog.surfaceGroups.repositorySettings.surfaces) {
    const tab = await visibleTab(dialog, surface.label)
    if (tab === null) {
      ledger.push({
        id: `repository-settings.${surface.member}`,
        status: surface.conditional ? 'not-applicable' : 'blocked',
      })
      continue
    }
    await tab.click()
    await settle(page)
    ledger.push(
      await safeAuditMatrix(
        page,
        session,
        options,
        `repository-settings.${surface.member}`,
        '#repository-settings'
      )
    )

    if (surface.member === 'Appearance') {
      const studio = catalog.nestedSurfaces.find(
        item => item.id === 'repository-settings.appearance.logo-studio'
      )
      if (studio !== undefined) {
        ledger.push(
          await safeAuditMatrix(
            page,
            session,
            options,
            studio.id,
            studio.ownerSelector,
            studio.selector
          )
        )
      }
    }
  }
  await closeTopDialog(page)
}

async function auditCloneTabs(page, session, options, ledger) {
  await emitMenuEvent(page, 'clone-repository')
  const dialog = page.locator('dialog.clone-repository')
  await dialog.waitFor({ state: 'visible', timeout: 10_000 })
  for (const surface of catalog.surfaceGroups.cloneTabs.surfaces) {
    const tab = await visibleTab(dialog, surface.label)
    if (tab === null) {
      ledger.push({ id: `clone.${surface.member}`, status: 'blocked' })
      continue
    }
    await tab.click()
    await settle(page)
    ledger.push(
      await safeAuditMatrix(
        page,
        session,
        options,
        `clone.${surface.member}`,
        'dialog.clone-repository'
      )
    )
  }
  await closeTopDialog(page)
}

async function auditNotifications(page, session, options, ledger) {
  const toggle = page.getByRole('button', {
    name: /^Notifications(?: \(\d+ unread\))?$/,
  })
  if ((await toggle.count()) === 0 || !(await toggle.first().isVisible())) {
    for (const nested of catalog.nestedSurfaces.filter(item =>
      item.id.startsWith('notifications.')
    )) {
      ledger.push({
        id: nested.id,
        status: 'blocked',
        notes: 'The notification centre toggle was unavailable.',
      })
    }
    return
  }

  await toggle.first().click()
  const panel = page.locator('.notification-centre-panel')
  await panel.waitFor({ state: 'visible', timeout: 10_000 })
  for (const nested of catalog.nestedSurfaces.filter(item =>
    item.id.startsWith('notifications.')
  )) {
    const tab = await visibleTab(panel, nested.label)
    if (tab === null) {
      ledger.push({ id: nested.id, status: 'blocked' })
      continue
    }
    await tab.click()
    await settle(page)
    ledger.push(
      await safeAuditMatrix(
        page,
        session,
        options,
        nested.id,
        '.notification-centre-panel'
      )
    )
  }
  await panel
    .getByRole('button', { name: 'Close notifications', exact: true })
    .click()
  await panel.waitFor({ state: 'hidden', timeout: 10_000 })
  await settle(page)
}

async function installFileHistoryMenuSelection(page) {
  await page.evaluate(() => {
    const ipcRenderer = require('electron').ipcRenderer
    const original = ipcRenderer.invoke.bind(ipcRenderer)
    const findPath = (items, prefix = []) => {
      for (let index = 0; index < items.length; index += 1) {
        const item = items[index]
        if (/file history/i.test(item.label ?? '')) {
          return [...prefix, index]
        }
        if (Array.isArray(item.submenu)) {
          const nested = findPath(item.submenu, [...prefix, index])
          if (nested !== null) {
            return nested
          }
        }
      }
      return null
    }

    globalThis.__materialFileHistoryMenu = {
      original,
      selected: false,
    }
    ipcRenderer.invoke = (channel, ...args) => {
      if (channel === 'show-contextual-menu') {
        const indices = findPath(args[0] ?? [])
        globalThis.__materialFileHistoryMenu.selected = indices !== null
        return Promise.resolve(indices)
      }
      return original(channel, ...args)
    }
  })
}

async function restoreFileHistoryMenuSelection(page) {
  await page.evaluate(() => {
    const probe = globalThis.__materialFileHistoryMenu
    if (probe !== undefined) {
      require('electron').ipcRenderer.invoke = probe.original
      delete globalThis.__materialFileHistoryMenu
    }
  })
}

async function auditFileHistory(
  page,
  session,
  options,
  ledger,
  fileHistoryProbe
) {
  const surfaces = catalog.nestedSurfaces.filter(item =>
    item.id.startsWith('file-history.')
  )
  const changes = await visibleTab(page, 'Changes', '#changes-tab')
  if (changes === null) {
    for (const surface of surfaces) {
      ledger.push({
        id: surface.id,
        status: 'blocked',
        notes: 'The Changes page was unavailable.',
      })
    }
    return
  }

  await changes.click()
  await settle(page)
  const changesScrollRegions = page.locator(
    '#repository-sidebar .panel, #changes-list .ReactVirtualized__Grid'
  )
  if ((await changesScrollRegions.count()) > 0) {
    await changesScrollRegions.evaluateAll(elements => {
      for (const element of elements) {
        element.scrollTop = 0
      }
    })
    await settle(page, 250)
  }
  const changedFile = page
    .locator('#changes-list [role="option"]', { hasText: fileHistoryProbe })
    .first()
  let changedFileVisible = false
  try {
    await changedFile.waitFor({ state: 'visible', timeout: 10_000 })
    changedFileVisible = true
  } catch {
    changedFileVisible = false
  }
  if (!changedFileVisible) {
    for (const surface of surfaces) {
      ledger.push({
        id: surface.id,
        status: 'blocked',
        notes:
          'The deterministic probe exists on disk, but its changed-file row did not render.',
      })
    }
    return
  }

  await installFileHistoryMenuSelection(page)
  let opened = false
  try {
    await changedFile.click({ button: 'right' })
    const panel = page.locator('.file-history-panel')
    try {
      await panel.waitFor({ state: 'visible', timeout: 10_000 })
      opened = true
    } catch {
      opened = false
    }
  } finally {
    await restoreFileHistoryMenuSelection(page)
  }

  if (!opened) {
    for (const surface of surfaces) {
      ledger.push({
        id: surface.id,
        status: 'blocked',
        notes: 'The changed-file context menu did not open File History.',
      })
    }
    return
  }

  const panel = page.locator('.file-history-panel')
  for (const surface of surfaces) {
    const tab = await visibleTab(panel, surface.label)
    if (tab === null) {
      ledger.push({
        id: surface.id,
        status: 'blocked',
        notes: `The ${surface.label} tab was unavailable.`,
      })
      continue
    }
    await tab.click()
    await settle(page, 500)
    ledger.push(
      await safeAuditMatrix(
        page,
        session,
        options,
        surface.id,
        '.file-history-panel'
      )
    )
  }

  await panel
    .getByRole('button', { name: 'Close file history', exact: true })
    .click()
  await panel.waitFor({ state: 'detached', timeout: 10_000 })
  await settle(page)
}

async function openEventDialog(page, eventName) {
  const before = await page.locator('#dialog-layer dialog[open]').count()
  const panelsBefore = await visibleNonModalDialogCount(page)
  const noticesBefore = await page
    .locator('.error-notice-stack [role="alert"]')
    .count()
  await emitMenuEvent(page, eventName)
  try {
    await page.waitForFunction(
      expected =>
        document.querySelectorAll('#dialog-layer dialog[open]').length >
          expected.dialogs ||
        document.querySelectorAll('.error-notice-stack [role="alert"]').length >
          expected.notices ||
        [...document.querySelectorAll(expected.panelSelector)].filter(
          element => {
            const rect = element.getBoundingClientRect()
            const style = getComputedStyle(element)
            return (
              style.display !== 'none' &&
              style.visibility !== 'hidden' &&
              rect.width > 0 &&
              rect.height > 0
            )
          }
        ).length > expected.panels,
      {
        dialogs: before,
        notices: noticesBefore,
        panels: panelsBefore,
        panelSelector: nonModalDialogSelector,
      },
      { timeout: 8_000 }
    )
  } catch {
    return { kind: 'missing' }
  }
  const after = await page.locator('#dialog-layer dialog[open]').count()
  if (after > before) {
    return { kind: 'dialog' }
  }
  const panelsAfter = await visibleNonModalDialogCount(page)
  return panelsAfter > panelsBefore ? { kind: 'panel' } : { kind: 'notice' }
}

async function auditMenuDialogs(page, session, options, ledger) {
  for (const surface of catalog.surfaceGroups.menuDialogs.surfaces) {
    const eventName = surface.member
    const id = `menu.${eventName}`
    const opened = await openEventDialog(page, eventName)
    if (opened.kind === 'missing') {
      ledger.push({
        id,
        status: 'blocked',
        notes: 'The fixture did not expose the requested safe dialog.',
      })
      continue
    }
    if (opened.kind === 'notice') {
      const selector = '.error-notice-stack'
      ledger.push(await safeAuditMatrix(page, session, options, id, selector))
      const dismiss = page
        .locator('.error-notice-stack')
        .getByRole('button', { name: /Dismiss/ })
        .last()
      if ((await dismiss.count()) > 0) {
        await dismiss.click()
        await settle(page)
      }
      continue
    }
    if (opened.kind === 'panel') {
      ledger.push(
        await safeAuditMatrix(
          page,
          session,
          options,
          id,
          nonModalDialogSelector
        )
      )
      await closeTopDialog(page)
      continue
    }

    await settle(page, 500)
    ledger.push(
      await safeAuditMatrix(
        page,
        session,
        options,
        id,
        '#dialog-layer dialog[open][data-top-most]'
      )
    )
    await closeTopDialog(page)
  }
}

function buildCatalogMetadata() {
  const metadata = new Map()
  const groups = [
    ['repositorySections', 'repository', 'repository'],
    ['preferences', 'preferences', 'settings'],
    ['repositorySettings', 'repository-settings', 'repository-settings'],
    ['cloneTabs', 'clone', 'clone-dialog'],
    ['menuDialogs', 'menu', 'application-menu'],
  ]
  for (const [groupName, prefix, parentId] of groups) {
    const group = catalog.surfaceGroups[groupName]
    for (const surface of group.surfaces) {
      metadata.set(`${prefix}.${surface.member}`, {
        kind: group.kind,
        parentId,
        source: group.source,
        risk: group.risk,
        expected: `${surface.label} renders within every supported viewport and its final control remains reachable.`,
        conditional: surface.conditional === true,
      })
    }
  }
  for (const surface of catalog.nestedSurfaces) {
    metadata.set(surface.id, {
      kind: surface.kind,
      parentId: surface.parentId,
      source: surface.source,
      risk: surface.risk,
      expected: `${surface.label} renders within every supported viewport and its final control remains reachable.`,
      conditional: surface.conditional === true,
    })
  }
  return metadata
}

function decorateLedger(ledger, metadata) {
  return ledger.map(row => {
    const base = metadata.get(row.id)
    const menuSurface = row.id.startsWith('menu.')
    return {
      kind: base?.kind ?? (menuSurface ? 'dialog' : 'surface'),
      parentId: base?.parentId ?? (menuSurface ? 'application-menu' : null),
      source:
        base?.source ??
        (menuSurface ? 'app/src/ui/app.tsx#onMenuEvent' : 'runtime'),
      risk: base?.risk ?? 'safe',
      expected:
        base?.expected ??
        'The safe fixture surface opens, remains inside the viewport, and exposes every control through a reachable scroll owner.',
      ...row,
      attempts: row.attempts ?? [],
      evidence: row.evidence ?? [],
      capture: row.capture ?? null,
      notes: row.notes ?? null,
    }
  })
}

function validateLedger(ledger) {
  const statuses = new Set(['pass', 'failed', 'blocked', 'not-applicable'])
  const ids = new Set()
  for (const row of ledger) {
    if (typeof row.id !== 'string' || row.id.length === 0) {
      fail('Every responsive ledger row requires a non-empty id.')
    }
    if (ids.has(row.id)) {
      fail(`Duplicate responsive ledger row: ${row.id}.`)
    }
    ids.add(row.id)
    if (!statuses.has(row.status)) {
      fail(`Invalid responsive ledger status for ${row.id}: ${row.status}.`)
    }
    for (const field of ['kind', 'parentId', 'source', 'risk', 'expected']) {
      if (
        row[field] !== null &&
        (typeof row[field] !== 'string' || row[field].length === 0)
      ) {
        fail(`Invalid ${field} in responsive ledger row ${row.id}.`)
      }
    }
    if (!Array.isArray(row.attempts) || !Array.isArray(row.evidence)) {
      fail(`Invalid evidence arrays in responsive ledger row ${row.id}.`)
    }
    if (row.status === 'pass') {
      if (row.evidence.length !== catalog.viewportMatrix.length) {
        fail(`Incomplete responsive matrix evidence for ${row.id}.`)
      }
      if (
        row.capture === null ||
        typeof row.capture.path !== 'string' ||
        !/^[a-f0-9]{64}$/.test(row.capture.sha256)
      ) {
        fail(`Invalid responsive capture receipt for ${row.id}.`)
      }
      if (row.id === 'popup.batch-clone-recovery') {
        const state = row.fixtureState
        if (
          state?.title !== 'Clone queue paused' ||
          state?.itemCount !== BatchCloneRecoveryFixtureItemCount ||
          state?.interruptedCount !== BatchCloneRecoveryFixtureItemCount ||
          state?.resumeEnabled !== true ||
          state?.hidePresent !== true ||
          !state?.summary?.includes(
            `${BatchCloneRecoveryFixtureItemCount} interrupted`
          )
        ) {
          fail('The clone recovery ledger row lacks valid fixture state.')
        }
      }
    } else if (row.capture !== null) {
      fail(`Non-passing responsive ledger row ${row.id} retained a capture.`)
    }
  }
}

function findGateFailures(ledger, metadata) {
  const rowsById = new Map(ledger.map(row => [row.id, row]))
  const requiredFailures = [...metadata.entries()]
    .filter(([, entry]) => !entry.conditional)
    .filter(([id]) => rowsById.get(id)?.status !== 'pass')
    .map(([id]) => `${id}:${rowsById.get(id)?.status ?? 'missing'}`)
  const runtimeFailures = ledger
    .filter(row => row.status === 'failed')
    .map(row => row.id)
  return [...new Set([...requiredFailures, ...runtimeFailures])]
}

async function main() {
  const options = parseArguments(process.argv.slice(2))
  const fileHistoryProbe = prepareFileHistoryFixture(options.repositoryPath)
  const browser = await connect(options.port)
  const page = await getRenderer(browser)
  const session = await page.context().newCDPSession(page)
  const ledger = []
  let auditError = null
  try {
    await auditBatchCloneRecoveryPopup(page, session, options, ledger)
    await prepareApp(page, options.repositoryPath)
    await auditRepositorySections(page, session, options, ledger)
    await auditFileHistory(page, session, options, ledger, fileHistoryProbe)
    await auditPreferences(page, session, options, ledger)
    await auditRepositorySettings(page, session, options, ledger)
    await auditCloneTabs(page, session, options, ledger)
    await auditNotifications(page, session, options, ledger)
    await auditMenuDialogs(page, session, options, ledger)
  } catch (error) {
    auditError = error instanceof Error ? error : new Error(String(error))
  }

  // Every inventoried surface receives an explicit receipt, including when an
  // unexpected orchestration error stops the remaining audit. This preserves
  // a complete triage ledger instead of losing the already-collected evidence.
  const metadata = buildCatalogMetadata()
  const recordedIds = new Set(ledger.map(row => row.id))
  for (const id of metadata.keys()) {
    if (!recordedIds.has(id)) {
      ledger.push({
        id,
        status: auditError === null ? 'blocked' : 'failed',
        notes:
          auditError === null
            ? 'No safe deterministic runtime route was available in this run.'
            : `Audit stopped before this surface: ${auditError.message}`,
      })
    }
  }

  const decoratedLedger = decorateLedger(ledger, metadata)
  validateLedger(decoratedLedger)
  const result = {
    schemaVersion: 1,
    generatedAt: new Date().toISOString(),
    catalog: {
      schemaVersion: catalog.schemaVersion,
      viewportMatrix: catalog.viewportMatrix,
    },
    fixture: {
      fileHistoryProbe,
    },
    totals: decoratedLedger.reduce((totals, row) => {
      totals[row.status] = (totals[row.status] ?? 0) + 1
      return totals
    }, {}),
    ledger: decoratedLedger,
  }
  fs.writeFileSync(options.ledgerPath, `${JSON.stringify(result, null, 2)}\n`)
  process.stdout.write(`${JSON.stringify(result.totals)}\n`)

  if (auditError !== null) {
    fail(
      `Responsive audit stopped unexpectedly: ${auditError.message}. Ledger: ${options.ledgerPath}`
    )
  }

  const gateFailures = findGateFailures(decoratedLedger, metadata)
  if (gateFailures.length > 0) {
    fail(
      `Responsive coverage gate failed (${gateFailures.join(', ')}). Ledger: ${
        options.ledgerPath
      }`
    )
  }
  process.exit(0)
}

if (require.main === module) {
  main().catch(error => {
    process.stderr.write(`${error.stack ?? error}\n`)
    process.exit(1)
  })
}

module.exports = {
  buildCatalogMetadata,
  decorateLedger,
  findGateFailures,
  validateLedger,
}
