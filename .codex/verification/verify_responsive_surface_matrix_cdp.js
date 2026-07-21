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
const supportedThemes = new Set(['light', 'dark'])
const supportedLanguageModes = new Set(['english', 'cantonese', 'bilingual'])
const defaultRequestedAppearance = Object.freeze({
  theme: 'light',
  languageMode: 'english',
})
const expectedProviderIdentity = Object.freeze({
  accountLogin: 'material-verifier-p0',
  accountId: 7_130_701,
  owner: 'material-fixture-owner',
  repository: 'material-fixture',
})
const requiredBundledFonts = Object.freeze([
  Object.freeze({
    id: 'roboto-normal-400',
    family: 'Roboto',
    style: 'normal',
    css: 'normal 400 16px "Roboto"',
    sample: 'Desktop Material',
  }),
  Object.freeze({
    id: 'roboto-mono-normal-400',
    family: 'Roboto Mono',
    style: 'normal',
    css: 'normal 400 16px "Roboto Mono"',
    sample: 'git status --short',
  }),
  Object.freeze({
    id: 'roboto-serif-normal-400',
    family: 'Roboto Serif',
    style: 'normal',
    css: 'normal 400 16px "Roboto Serif"',
    sample: 'Desktop Material',
  }),
  Object.freeze({
    id: 'roboto-serif-italic-400',
    family: 'Roboto Serif',
    style: 'italic',
    css: 'italic 400 16px "Roboto Serif"',
    sample: 'Desktop Material',
  }),
  Object.freeze({
    id: 'material-symbols-rounded-normal-400',
    family: 'Material Symbols Rounded',
    style: 'normal',
    css: 'normal 400 24px "Material Symbols Rounded"',
    sample: 'settings',
  }),
])
const expectedAppearanceCopy = Object.freeze({
  english: Object.freeze({
    selectLabel: 'Language',
    globalIgnoreLabel: 'Ignore file',
  }),
  cantonese: Object.freeze({
    selectLabel: '語言',
    globalIgnoreLabel: '忽略規則檔案',
  }),
  bilingual: Object.freeze({
    selectLabel: 'Language · 語言',
    globalIgnoreLabel: 'Ignore file · 忽略規則檔案',
  }),
})

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

function assertProviderReadinessLocation(
  runRoot,
  providerDirectory,
  readyPath
) {
  if (
    !isWithin(runRoot, providerDirectory) ||
    !isWithin(providerDirectory, readyPath) ||
    path.relative(providerDirectory, readyPath) !== 'ready.json'
  ) {
    fail('Provider readiness resolves outside the owned provider directory.')
  }
}

function validateProviderIdentity(value) {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    fail('Provider readiness metadata is invalid.')
  }

  const {
    endpoint,
    bind,
    accountLogin,
    accountId,
    owner,
    repository,
    credentialService,
    workflowRunId,
    workflowRunCount,
  } = value
  let endpointURL = null
  try {
    endpointURL = new URL(endpoint)
  } catch {
    fail('Provider readiness endpoint is invalid.')
  }
  const loopbackHosts = new Set(['localhost', '127.0.0.1', '[::1]', '::1'])
  const normalizedEndpoint = `${endpointURL.protocol}//${endpointURL.host}/api/v3`
  if (
    endpointURL.protocol !== 'http:' ||
    !loopbackHosts.has(endpointURL.hostname) ||
    endpointURL.port.length === 0 ||
    endpointURL.username.length > 0 ||
    endpointURL.password.length > 0 ||
    endpointURL.search.length > 0 ||
    endpointURL.hash.length > 0 ||
    endpoint !== normalizedEndpoint ||
    typeof bind !== 'string' ||
    !loopbackHosts.has(bind)
  ) {
    fail('Provider readiness must use an exact loopback HTTP endpoint.')
  }
  if (
    accountLogin !== expectedProviderIdentity.accountLogin ||
    accountId !== expectedProviderIdentity.accountId ||
    owner !== expectedProviderIdentity.owner ||
    repository !== expectedProviderIdentity.repository ||
    credentialService !== `GitHub Desktop Dev - ${endpoint}` ||
    !Number.isSafeInteger(workflowRunId) ||
    workflowRunId <= 0 ||
    !Number.isSafeInteger(workflowRunCount) ||
    workflowRunCount <= 0 ||
    workflowRunCount > 10_000
  ) {
    fail('Provider readiness synthetic identity fields are invalid.')
  }

  // Intentionally return only bounded synthetic identity fields. The provider
  // token remains confined to ready.json and the secure credential helper.
  return {
    endpoint,
    accountLogin,
    accountId,
    owner,
    repository,
    workflowRunId,
    workflowRunCount,
  }
}

function readProviderIdentity(runRoot) {
  const providerDirectory = path.join(runRoot, 'provider')
  const readyPath = path.join(providerDirectory, 'ready.json')
  if (!fs.existsSync(providerDirectory) || !fs.existsSync(readyPath)) {
    fail('The owned provider readiness file is missing.')
  }
  const providerStat = fs.lstatSync(providerDirectory)
  const readyStat = fs.lstatSync(readyPath)
  if (providerStat.isSymbolicLink() || readyStat.isSymbolicLink()) {
    fail('Provider readiness may not traverse a symbolic link or junction.')
  }
  if (!providerStat.isDirectory() || !readyStat.isFile()) {
    fail('The owned provider readiness file is missing.')
  }
  if (readyStat.size < 2 || readyStat.size > 32_768) {
    fail('Provider readiness file size is invalid.')
  }

  const realProviderDirectory = realpathSync(providerDirectory)
  const realReadyPath = realpathSync(readyPath)
  assertProviderReadinessLocation(runRoot, realProviderDirectory, realReadyPath)

  let parsed = null
  try {
    parsed = JSON.parse(fs.readFileSync(realReadyPath, 'utf8'), (key, value) =>
      key === 'token' ? undefined : value
    )
  } catch {
    fail('Provider readiness JSON is invalid.')
  }
  return validateProviderIdentity(parsed)
}

function parseAppearanceOptions(
  theme = defaultRequestedAppearance.theme,
  languageMode = defaultRequestedAppearance.languageMode
) {
  if (!supportedThemes.has(theme)) {
    fail('theme must be light or dark.')
  }
  if (!supportedLanguageModes.has(languageMode)) {
    fail('language-mode must be english, cantonese, or bilingual.')
  }
  return { theme, languageMode }
}

function parseArguments(argv) {
  const values = new Map()
  const allowed = new Set([
    'port',
    'run-root',
    'repository-path',
    'ledger',
    'capture-directory',
    'theme',
    'language-mode',
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
  const providerIdentity = readProviderIdentity(runRoot)
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
    requestedAppearance: parseAppearanceOptions(
      values.get('theme') ?? undefined,
      values.get('language-mode') ?? undefined
    ),
    providerIdentity,
    providerMutationBaseline: null,
    providerMutationReceipt: null,
    providerRemoteReceipt: null,
    providerReceipt: null,
    appearanceUIReceipt: null,
    observedAppearance: null,
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

function ensureDirectFixtureProviderRemote(repositoryPath, identity) {
  const endpoint = new URL(identity.endpoint)
  const directURL = `${endpoint.origin}/${identity.owner}/${identity.repository}.git`
  const storedURL = `http://material-provider.invalid/${identity.owner}/${identity.repository}.git`
  const expectedProxy = `http://127.0.0.1:${endpoint.port}`
  let proxyValues = []
  try {
    proxyValues = execFileSync(
      'git',
      ['-C', repositoryPath, 'config', '--get-all', 'http.proxy'],
      { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }
    )
      .split(/\r?\n/)
      .map(value => value.trim())
      .filter(value => value.length > 0)
  } catch (error) {
    if (error?.status !== 1) {
      throw error
    }
  }
  const currentURL = execFileSync(
    'git',
    ['-C', repositoryPath, 'remote', 'get-url', 'origin'],
    { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }
  ).trim()
  const storedState =
    currentURL === storedURL &&
    proxyValues.length === 1 &&
    proxyValues[0] === expectedProxy
  const directState = currentURL === directURL && proxyValues.length === 0
  if (!storedState && !directState) {
    fail('The owned fixture remote/proxy does not match provider readiness.')
  }

  if (storedState) {
    execFileSync(
      'git',
      ['-C', repositoryPath, 'remote', 'set-url', 'origin', directURL],
      { stdio: 'ignore' }
    )
    execFileSync(
      'git',
      ['-C', repositoryPath, 'config', '--unset-all', 'http.proxy'],
      { stdio: 'ignore' }
    )
  }

  const verifiedURL = execFileSync(
    'git',
    ['-C', repositoryPath, 'remote', 'get-url', 'origin'],
    { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }
  ).trim()
  let verifiedProxy = ''
  try {
    verifiedProxy = execFileSync(
      'git',
      ['-C', repositoryPath, 'config', '--get-all', 'http.proxy'],
      { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }
    ).trim()
  } catch (error) {
    if (error?.status !== 1) {
      throw error
    }
  }
  if (verifiedURL !== directURL || verifiedProxy.length > 0) {
    fail('The owned fixture did not retain the direct loopback remote.')
  }
  return {
    changed: storedState,
    directLoopbackRemote: true,
    proxyRemoved: true,
  }
}

function countProviderMutationRequests(runRoot) {
  const providerDirectory = path.join(runRoot, 'provider')
  const requestLog = path.join(providerDirectory, 'requests.jsonl')
  if (!fs.existsSync(requestLog)) {
    fail('The owned provider request ledger is missing.')
  }
  const requestStat = fs.lstatSync(requestLog)
  if (!requestStat.isFile() || requestStat.isSymbolicLink()) {
    fail('The owned provider request ledger is invalid.')
  }
  const realProviderDirectory = realpathSync(providerDirectory)
  const realRequestLog = realpathSync(requestLog)
  if (
    !isWithin(runRoot, realProviderDirectory) ||
    !isWithin(realProviderDirectory, realRequestLog)
  ) {
    fail('The provider request ledger resolves outside the owned run root.')
  }
  const mutationMethods = new Set(['POST', 'PUT', 'PATCH', 'DELETE'])
  const recognizedMethods = new Set([
    'GET',
    'HEAD',
    'OPTIONS',
    ...mutationMethods,
  ])
  try {
    const entries = fs
      .readFileSync(realRequestLog, 'utf8')
      .split(/\r?\n/)
      .filter(line => line.trim().length > 0)
      .map(line => JSON.parse(line))
    if (
      entries.some(
        entry =>
          typeof entry !== 'object' ||
          entry === null ||
          !recognizedMethods.has(entry.method)
      )
    ) {
      fail('The provider request ledger contains an invalid HTTP method.')
    }
    return entries.filter(entry => mutationMethods.has(entry.method)).length
  } catch {
    fail('The provider request ledger is invalid.')
  }
}

function providerMutationReceipt(baseline, final) {
  if (
    !Number.isSafeInteger(baseline) ||
    baseline < 0 ||
    !Number.isSafeInteger(final) ||
    final < baseline
  ) {
    fail('The provider mutation receipt is invalid.')
  }
  const receipt = { baseline, final, delta: final - baseline }
  if (receipt.delta !== 0) {
    fail('The responsive audit issued a provider mutation request.')
  }
  return receipt
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

async function assertBundledFontsLoaded(page) {
  const receipt = await page.evaluate(
    async ({ specs, timeout }) => {
      const base = {
        fontFaceSetPresent: document.fonts !== undefined,
        fontsReady: false,
        bodyUsesRoboto: false,
        faces: specs.map(spec => ({
          id: spec.id,
          loadResolved: false,
          registeredLoadedFace: false,
          checkPassed: false,
        })),
      }
      if (document.fonts === undefined) {
        return base
      }

      base.fontsReady = await Promise.race([
        document.fonts.ready.then(
          () => true,
          () => false
        ),
        new Promise(resolve => setTimeout(() => resolve(false), timeout)),
      ])
      if (!base.fontsReady) {
        return base
      }

      for (let index = 0; index < specs.length; index++) {
        const spec = specs[index]
        const loadedFaces = await Promise.race([
          document.fonts.load(spec.css, spec.sample).then(
            faces => faces,
            () => null
          ),
          new Promise(resolve => setTimeout(() => resolve(null), timeout)),
        ])
        const normalizedFamily = family =>
          family.replace(/^['"]|['"]$/g, '').trim()
        base.faces[index].loadResolved =
          Array.isArray(loadedFaces) && loadedFaces.length > 0
        base.faces[index].registeredLoadedFace = [...document.fonts].some(
          face =>
            normalizedFamily(face.family) === spec.family &&
            face.style === spec.style &&
            face.status === 'loaded'
        )
        base.faces[index].checkPassed = document.fonts.check(
          spec.css,
          spec.sample
        )
      }

      const primaryBodyFamily = getComputedStyle(document.body)
        .fontFamily.split(',')[0]
        .replace(/^['"]|['"]$/g, '')
        .trim()
      base.bodyUsesRoboto = primaryBodyFamily === 'Roboto'
      return base
    },
    { specs: requiredBundledFonts, timeout: 10_000 }
  )

  if (
    receipt.fontFaceSetPresent !== true ||
    receipt.fontsReady !== true ||
    receipt.bodyUsesRoboto !== true ||
    receipt.faces.length !== requiredBundledFonts.length ||
    receipt.faces.some(
      face =>
        face.loadResolved !== true ||
        face.registeredLoadedFace !== true ||
        face.checkPassed !== true
    )
  ) {
    fail(`Bundled font readiness failed: ${JSON.stringify(receipt)}`)
  }
  return receipt
}

async function settle(page, delay = 350) {
  await page.waitForTimeout(delay)
  await page.locator('#window-zoom-info').waitFor({
    state: 'detached',
    timeout: 5_000,
  })
  await assertBundledFontsLoaded(page)
}

async function emitMenuEvent(page, name) {
  await page.evaluate(value => {
    require('electron').ipcRenderer.emit('menu-event', {}, value)
  }, name)
}

function emptyObservedAppearance() {
  return {
    theme: null,
    languageMode: null,
    persistedTheme: null,
    persistedLanguageMode: null,
    bodyThemeClasses: [],
    documentLanguageMode: null,
    documentLanguage: null,
  }
}

function matchingObservedAppearance(requested) {
  return {
    theme: requested.theme,
    languageMode: requested.languageMode,
    persistedTheme: requested.theme,
    persistedLanguageMode: requested.languageMode,
    bodyThemeClasses: [`theme-${requested.theme}`],
    documentLanguageMode: requested.languageMode,
    documentLanguage: requested.languageMode === 'cantonese' ? 'zh-HK' : 'en',
  }
}

function emptyAppearanceUIReceipt() {
  return {
    preferenceDialogObserved: false,
    selectObserved: false,
    selectValue: null,
    selectOptionCount: 0,
    selectOptionsExact: false,
    selectLabelAssociated: false,
    selectLabelLocalized: false,
    globalIgnoreObserved: false,
    visibleMode: null,
    visibleEnglishPresent: false,
    visibleCantonesePresent: false,
    bilingualStructure: false,
    primaryAccessibleNameMatched: false,
  }
}

function matchingAppearanceUIReceipt(requested) {
  return {
    preferenceDialogObserved: true,
    selectObserved: true,
    selectValue: requested.languageMode,
    selectOptionCount: supportedLanguageModes.size,
    selectOptionsExact: true,
    selectLabelAssociated: true,
    selectLabelLocalized: true,
    globalIgnoreObserved: true,
    visibleMode: requested.languageMode,
    visibleEnglishPresent: requested.languageMode !== 'cantonese',
    visibleCantonesePresent: requested.languageMode !== 'english',
    bilingualStructure: requested.languageMode === 'bilingual',
    primaryAccessibleNameMatched: true,
  }
}

function appearanceReceipt(
  requested,
  observed = emptyObservedAppearance(),
  ui = emptyAppearanceUIReceipt()
) {
  return {
    requested: { ...requested },
    observed: {
      ...observed,
      bodyThemeClasses: [...observed.bodyThemeClasses],
    },
    ui: { ...ui },
  }
}

function assertAppearanceState(requested, observed, label) {
  const expectedThemeClass = `theme-${requested.theme}`
  const expectedDocumentLanguage =
    requested.languageMode === 'cantonese' ? 'zh-HK' : 'en'
  if (
    observed.theme !== requested.theme ||
    observed.languageMode !== requested.languageMode ||
    observed.persistedTheme !== requested.theme ||
    observed.persistedLanguageMode !== requested.languageMode ||
    observed.bodyThemeClasses.length !== 1 ||
    observed.bodyThemeClasses[0] !== expectedThemeClass ||
    observed.documentLanguageMode !== requested.languageMode ||
    observed.documentLanguage !== expectedDocumentLanguage
  ) {
    fail(
      `${label}: requested theme/language were not observed: ${JSON.stringify(
        appearanceReceipt(requested, observed)
      )}`
    )
  }
}

async function observeAppearanceState(page) {
  return page.evaluate(() => {
    const bodyThemeClasses = [...document.body.classList]
      .filter(value => value.startsWith('theme-'))
      .sort()
    const theme =
      bodyThemeClasses.length === 1 && bodyThemeClasses[0] === 'theme-light'
        ? 'light'
        : bodyThemeClasses.length === 1 && bodyThemeClasses[0] === 'theme-dark'
        ? 'dark'
        : null
    return {
      theme,
      languageMode: document.body.getAttribute('data-dm-language-mode'),
      persistedTheme: localStorage.getItem('theme'),
      persistedLanguageMode: localStorage.getItem('language-mode-v1'),
      bodyThemeClasses,
      documentLanguageMode:
        document.documentElement.getAttribute('data-language-mode'),
      documentLanguage: document.documentElement.lang,
    }
  })
}

async function observeAndAssertAppearance(page, options, label) {
  const observed = await observeAppearanceState(page)
  options.observedAppearance = observed
  assertAppearanceState(options.requestedAppearance, observed, label)
  return appearanceReceipt(
    options.requestedAppearance,
    observed,
    options.appearanceUIReceipt ?? emptyAppearanceUIReceipt()
  )
}

function persistedProviderUsers(identity) {
  return JSON.stringify([
    {
      token: '',
      login: identity.accountLogin,
      endpoint: identity.endpoint,
      emails: [
        {
          email: 'material-verifier@example.invalid',
          verified: true,
          primary: true,
          visibility: 'private',
        },
      ],
      avatarURL: '',
      id: identity.accountId,
      name: 'Material Verification Account',
      plan: 'enterprise',
      provider: 'github',
    },
  ])
}

async function prepareAppearance(page, options) {
  await page.locator('#desktop-app-contents').waitFor({
    state: 'visible',
    timeout: 30_000,
  })

  const changed = await page.evaluate(
    ({ requested, users }) => {
      const expected = {
        theme: requested.theme,
        'language-mode-v1': requested.languageMode,
        'has-shown-welcome-flow': '1',
        'zoom-auto-fit-enabled': '0',
        'stats-opt-out': '1',
        'has-sent-stats-opt-in-ping': '1',
        users,
      }
      let didChange = false
      for (const [key, value] of Object.entries(expected)) {
        if (localStorage.getItem(key) !== value) {
          localStorage.setItem(key, value)
          didChange = true
        }
      }
      return didChange
    },
    {
      requested: options.requestedAppearance,
      users: persistedProviderUsers(options.providerIdentity),
    }
  )
  if (changed) {
    await page.reload({ waitUntil: 'domcontentloaded' })
    await page.locator('#desktop-app-contents').waitFor({
      state: 'visible',
      timeout: 30_000,
    })
  }

  await page
    .waitForFunction(
      requested => {
        const expectedThemeClass = `theme-${requested.theme}`
        const themeClasses = [...document.body.classList].filter(value =>
          value.startsWith('theme-')
        )
        return (
          themeClasses.length === 1 &&
          themeClasses[0] === expectedThemeClass &&
          document.body.getAttribute('data-dm-language-mode') ===
            requested.languageMode &&
          document.documentElement.getAttribute('data-language-mode') ===
            requested.languageMode
        )
      },
      options.requestedAppearance,
      { timeout: 30_000 }
    )
    .catch(() => undefined)

  return observeAndAssertAppearance(page, options, 'application preparation')
}

async function prepareApp(page, repositoryPath) {
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
    if (!(await add.isEnabled())) {
      fail('The deterministic repository was not selectable.')
    }
    await add.click()
    await addHeading.waitFor({ state: 'detached', timeout: 30_000 })
  }

  await history.waitFor({ state: 'visible', timeout: 30_000 })
  await settle(page)
}

function assertProviderHydrationReceipt(receipt, identity) {
  if (
    receipt?.appStorePresent !== true ||
    receipt?.accountsStorePresent !== true ||
    receipt?.actionsStorePresent !== true ||
    receipt?.accountReloadCompleted !== true ||
    receipt?.accountRefreshCompleted !== true ||
    receipt?.accountCount !== 1 ||
    receipt?.accountMatched !== true ||
    receipt?.credentialTokenPresent !== true ||
    receipt?.repositoryRefreshCompleted !== true ||
    receipt?.repositoryPathMatched !== true ||
    receipt?.refreshedRepositoryMatched !== true ||
    receipt?.selectedRepositoryMatched !== true ||
    receipt?.actionsRefreshCompleted !== true ||
    receipt?.actionsSupported !== true ||
    receipt?.actionsLoading !== false ||
    receipt?.actionsErrorPresent !== false ||
    receipt?.workflowCount < 1 ||
    receipt?.activeWorkflowCount < 1 ||
    receipt?.runCount < 1 ||
    receipt?.runsTotalCount !== identity.workflowRunCount ||
    receipt?.sentinelRunMatched !== true ||
    receipt?.identity?.login !== identity.accountLogin ||
    receipt?.identity?.endpoint !== identity.endpoint ||
    receipt?.identity?.id !== identity.accountId ||
    receipt?.identity?.owner !== identity.owner ||
    receipt?.identity?.repository !== identity.repository
  ) {
    fail(
      `Disposable provider account/repository/Actions hydration failed: ${JSON.stringify(
        receipt
      )}`
    )
  }
}

async function hydrateProviderFixture(page, options) {
  const identity = options.providerIdentity
  const receipt = await page.evaluate(
    async ({ expected, repositoryPath }) => {
      const base = {
        identity: {
          login: expected.accountLogin,
          endpoint: expected.endpoint,
          id: expected.accountId,
          owner: expected.owner,
          repository: expected.repository,
        },
        appStorePresent: false,
        accountsStorePresent: false,
        actionsStorePresent: false,
        accountReloadCompleted: false,
        accountRefreshCompleted: false,
        accountCount: 0,
        accountMatched: false,
        credentialTokenPresent: false,
        repositoryRefreshCompleted: false,
        repositoryPathMatched: false,
        refreshedRepositoryMatched: false,
        selectedRepositoryMatched: false,
        actionsRefreshCompleted: false,
        actionsSupported: false,
        actionsLoading: null,
        actionsErrorPresent: true,
        workflowCount: 0,
        activeWorkflowCount: 0,
        runCount: 0,
        runsTotalCount: 0,
        sentinelRunMatched: false,
      }
      try {
        const root = document.querySelector('#desktop-app-container')
        const node = root?.querySelector('*')
        const fiberKey =
          node &&
          Object.keys(node).find(
            key =>
              key.startsWith('__reactFiber$') ||
              key.startsWith('__reactInternalInstance$')
          )
        let fiber = fiberKey ? node[fiberKey] : null
        let appStore = null
        let actionsStore = null
        for (
          let depth = 0;
          fiber !== null && depth < 120;
          depth++, fiber = fiber.return
        ) {
          if (fiber.stateNode?.props?.appStore) {
            appStore = fiber.stateNode.props.appStore
            actionsStore = fiber.stateNode.props.actionsStore ?? null
            break
          }
        }
        base.appStorePresent = appStore !== null
        base.accountsStorePresent = appStore?.accountsStore !== undefined
        base.actionsStorePresent = actionsStore !== null
        if (
          appStore === null ||
          appStore.accountsStore === undefined ||
          actionsStore === null
        ) {
          return base
        }

        const bounded = promise =>
          Promise.race([
            promise.then(
              value => ({ status: 'complete', value }),
              () => ({ status: 'failed', value: null })
            ),
            new Promise(resolve =>
              setTimeout(
                () => resolve({ status: 'timeout', value: null }),
                30_000
              )
            ),
          ])

        const reload = await bounded(appStore.accountsStore.reloadFromStore())
        base.accountReloadCompleted = reload.status === 'complete'
        const refresh = await bounded(appStore.accountsStore.refresh())
        base.accountRefreshCompleted = refresh.status === 'complete'
        const accounts = await appStore.accountsStore.getAll()
        const fixtureAccount = accounts.find(
          value =>
            value.provider === 'github' &&
            value.login === expected.accountLogin &&
            value.endpoint === expected.endpoint &&
            value.id === expected.accountId
        )
        base.accountCount = accounts.length
        base.accountMatched = fixtureAccount !== undefined
        base.credentialTokenPresent =
          typeof fixtureAccount?.token === 'string' &&
          fixtureAccount.token.length > 0

        const selectedBefore = appStore.selectedRepository
        base.repositoryPathMatched =
          typeof selectedBefore?.path === 'string' &&
          selectedBefore.path.toLowerCase() === repositoryPath.toLowerCase()
        const repositoryRefresh =
          selectedBefore === null
            ? { status: 'missing', value: null }
            : await bounded(
                appStore.repositoryWithRefreshedGitHubRepository(selectedBefore)
              )
        base.repositoryRefreshCompleted =
          repositoryRefresh.status === 'complete'
        await new Promise(resolve => setTimeout(resolve, 500))

        const repositoryMatches = repository => {
          const gitHub = repository?.gitHubRepository
          return (
            gitHub?.endpoint === expected.endpoint &&
            gitHub?.owner?.login === expected.owner &&
            gitHub?.name === expected.repository
          )
        }
        const refreshedRepository = repositoryRefresh.value
        const selectedRepository = appStore.selectedRepository
        base.refreshedRepositoryMatched = repositoryMatches(refreshedRepository)
        base.selectedRepositoryMatched = repositoryMatches(selectedRepository)

        const actionsRepository = base.selectedRepositoryMatched
          ? selectedRepository
          : refreshedRepository
        if (actionsRepository === null) {
          return base
        }
        let latestActions = null
        const subscription = actionsStore.subscribe(
          actionsRepository,
          state => {
            latestActions = state
          }
        )
        try {
          const actionsRefresh = await bounded(
            actionsStore.refresh(actionsRepository, true)
          )
          base.actionsRefreshCompleted = actionsRefresh.status === 'complete'
          await new Promise(resolve => setTimeout(resolve, 250))
        } finally {
          subscription.dispose()
        }

        base.actionsSupported = latestActions?.supported === true
        base.actionsLoading = latestActions?.loading ?? null
        base.actionsErrorPresent = latestActions?.error != null
        base.workflowCount = latestActions?.workflows?.length ?? 0
        base.activeWorkflowCount =
          latestActions?.workflows?.filter(value => value.state === 'active')
            .length ?? 0
        base.runCount = latestActions?.runs?.length ?? 0
        base.runsTotalCount = latestActions?.runsTotalCount ?? 0
        base.sentinelRunMatched =
          latestActions?.runs?.some(
            value => value.id === expected.workflowRunId
          ) ?? false
        return base
      } catch {
        return base
      }
    },
    { expected: identity, repositoryPath: options.repositoryPath }
  )

  options.providerReceipt = receipt
  assertProviderHydrationReceipt(receipt, identity)
  await settle(page)
  return receipt
}

async function auditAppearancePreferenceUI(page, options) {
  const requested = options.requestedAppearance
  const copy = expectedAppearanceCopy[requested.languageMode]
  const dialog = page.locator('#preferences')
  let receipt = null
  let routeError = null

  try {
    await emitMenuEvent(page, 'show-preferences')
    await dialog.waitFor({ state: 'visible', timeout: 10_000 })

    const appearanceTab = await visibleTab(dialog, 'Appearance')
    if (appearanceTab === null) {
      fail('The persisted Appearance preference tab is unavailable.')
    }
    await appearanceTab.click()
    await settle(page)

    const languageSelect = dialog.locator('select[name="languageMode"]')
    await languageSelect.waitFor({ state: 'visible', timeout: 10_000 })
    const selectReceipt = await languageSelect.evaluate(
      (select, expected) => {
        const labels = [...select.labels]
        const optionValues = [...select.options].map(option => option.value)
        return {
          selectObserved: select.isConnected,
          selectValue: select.value,
          selectOptionCount: select.options.length,
          selectOptionsExact:
            optionValues.length === expected.optionValues.length &&
            optionValues.every(
              (value, index) => value === expected.optionValues[index]
            ),
          selectLabelAssociated: labels.length === 1,
          selectLabelLocalized:
            labels.length === 1 &&
            labels[0].textContent?.trim() === expected.label,
        }
      },
      {
        label: copy.selectLabel,
        optionValues: ['english', 'cantonese', 'bilingual'],
      }
    )

    const gitTab = await visibleTab(dialog, 'Git')
    if (gitTab === null) {
      fail('The Git preference tab is unavailable for language verification.')
    }
    await gitTab.click()
    await settle(page)

    const globalIgnoreTab = await visibleTab(dialog, 'Global ignore')
    if (globalIgnoreTab === null) {
      fail('The Global ignore preference tab is unavailable.')
    }
    await globalIgnoreTab.click()
    await settle(page)

    const globalIgnorePath = dialog.locator('#global-ignore-path')
    await globalIgnorePath.waitFor({ state: 'visible', timeout: 10_000 })
    const localizedReceipt = await globalIgnorePath.evaluate(
      (input, expected) => {
        const label = input.labels.length === 1 ? input.labels[0] : null
        const localized = label?.querySelector('.localized-text') ?? null
        const english = localized?.querySelector(':scope > [lang="en"]') ?? null
        const cantonese =
          localized?.querySelector(':scope > [lang="zh-HK"]') ?? null
        const separator =
          localized?.querySelector(':scope > .localized-text-separator') ?? null
        const text = localized?.textContent?.trim() ?? ''
        const englishText = english?.textContent?.trim() ?? ''
        const cantoneseText = cantonese?.textContent?.trim() ?? ''
        const primaryAccessibleName =
          expected.mode === 'cantonese'
            ? expected.cantoneseLabel
            : expected.englishLabel

        return {
          globalIgnoreObserved:
            input.isConnected && label !== null && localized !== null,
          visibleMode: localized?.getAttribute('data-language-mode') ?? null,
          visibleEnglishPresent:
            expected.mode === 'english'
              ? localized?.getAttribute('lang') === 'en' &&
                text === expected.englishLabel
              : expected.mode === 'bilingual' &&
                englishText === expected.englishLabel,
          visibleCantonesePresent:
            expected.mode === 'cantonese'
              ? localized?.getAttribute('lang') === 'zh-HK' &&
                text === expected.cantoneseLabel
              : expected.mode === 'bilingual' &&
                cantoneseText === expected.cantoneseLabel,
          bilingualStructure:
            expected.mode === 'bilingual' &&
            localized?.children.length === 3 &&
            localized.children[0] === english &&
            localized.children[1] === separator &&
            localized.children[2] === cantonese &&
            separator?.getAttribute('aria-hidden') === 'true' &&
            separator.textContent?.trim() === '·' &&
            text === expected.bilingualLabel,
          primaryAccessibleNameMatched:
            input.getAttribute('aria-label') === primaryAccessibleName,
        }
      },
      {
        mode: requested.languageMode,
        englishLabel: expectedAppearanceCopy.english.globalIgnoreLabel,
        cantoneseLabel: expectedAppearanceCopy.cantonese.globalIgnoreLabel,
        bilingualLabel: expectedAppearanceCopy.bilingual.globalIgnoreLabel,
      }
    )

    receipt = {
      preferenceDialogObserved: await dialog.isVisible(),
      ...selectReceipt,
      ...localizedReceipt,
    }
    options.appearanceUIReceipt = receipt
    const appearance = await observeAndAssertAppearance(
      page,
      options,
      'persisted Appearance preference UI'
    )
    validateAppearanceReceipt(
      appearance,
      'persisted Appearance preference UI',
      true
    )
  } catch (error) {
    routeError = error instanceof Error ? error : new Error(String(error))
  } finally {
    try {
      await closeTopDialog(page)
    } catch (error) {
      const cleanupError =
        error instanceof Error ? error : new Error(String(error))
      routeError =
        routeError === null
          ? cleanupError
          : new Error(
              `${routeError.message} Appearance preference teardown failed: ${cleanupError.message}`
            )
    }
  }

  if (routeError !== null) {
    throw routeError
  }
  return receipt
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
  let appearance = appearanceReceipt(
    options.requestedAppearance,
    options.observedAppearance ?? emptyObservedAppearance()
  )
  try {
    for (const scenario of catalog.viewportMatrix) {
      const metrics = await setMetrics(page, session, scenario)
      appearance = await observeAndAssertAppearance(
        page,
        options,
        `${id}/${scenario.id}`
      )
      const receipt = await inspectSurface(page, selector, targetSelector)
      assertReceipt(receipt, `${id}/${scenario.id}`)
      evidence.push({ scenario, metrics, appearance, receipt })
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
  return { id, status: 'pass', appearance, evidence, capture }
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
    const appearance = await observeAndAssertAppearance(
      page,
      options,
      `${id}/failure receipt`
    ).catch(() =>
      appearanceReceipt(
        options.requestedAppearance,
        options.observedAppearance ?? emptyObservedAppearance()
      )
    )
    row = {
      id,
      status: 'failed',
      appearance,
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
    const appearance = await observeAndAssertAppearance(
      page,
      options,
      `${id}/failure receipt`
    ).catch(() =>
      appearanceReceipt(
        options.requestedAppearance,
        options.observedAppearance ?? emptyObservedAppearance()
      )
    )
    return {
      id,
      status: 'failed',
      appearance,
      evidence: [],
      capture: null,
      notes: error instanceof Error ? error.message : String(error),
    }
  }
}

function requiredNestedRoute(id) {
  const surface = catalog.nestedSurfaces.find(item => item.id === id)
  if (surface === undefined) {
    fail(`Required responsive route is missing from the catalog: ${id}.`)
  }
  if (surface.conditional === true) {
    fail(`Deterministic responsive route must not be conditional: ${id}.`)
  }
  for (const field of ['ownerSelector', 'selector']) {
    if (typeof surface[field] !== 'string' || surface[field].length === 0) {
      fail(`Required responsive route ${id} lacks ${field}.`)
    }
  }
  return surface
}

async function failedRouteRow(page, options, id, error) {
  const appearance = await observeAndAssertAppearance(
    page,
    options,
    `${id}/route failure receipt`
  ).catch(() =>
    appearanceReceipt(
      options.requestedAppearance,
      options.observedAppearance ?? emptyObservedAppearance()
    )
  )
  return {
    id,
    status: 'failed',
    appearance,
    evidence: [],
    capture: null,
    notes: error instanceof Error ? error.message : String(error),
  }
}

async function auditAccountSwitcher(page, session, options, ledger) {
  const surface = requiredNestedRoute('repository.account-switcher')
  const trigger = page.getByRole('button', {
    name: 'Switch account',
    exact: true,
  })
  const dialog = page.locator(surface.selector).last()
  let row = null
  let routeError = null

  try {
    await trigger.waitFor({ state: 'visible', timeout: 10_000 })
    if (await dialog.isVisible().catch(() => false)) {
      fail('The account switcher was already open before its audit route.')
    }
    await trigger.click()
    await dialog.waitFor({ state: 'visible', timeout: 10_000 })
    await dialog
      .locator('.account-switcher-row')
      .first()
      .waitFor({ state: 'visible', timeout: 30_000 })
    await dialog
      .getByRole('button', { name: 'Add another account', exact: true })
      .waitFor({ state: 'visible', timeout: 10_000 })
    row = await safeAuditMatrix(
      page,
      session,
      options,
      surface.id,
      surface.ownerSelector,
      surface.selector
    )
  } catch (error) {
    routeError = error
  } finally {
    try {
      if (await dialog.isVisible().catch(() => false)) {
        await page.keyboard.press('Escape')
        await dialog.waitFor({ state: 'hidden', timeout: 10_000 })
      }
      if ((await trigger.getAttribute('aria-expanded')) !== 'false') {
        fail('The account switcher route did not restore its closed state.')
      }
      await settle(page)
    } catch (error) {
      routeError =
        routeError ??
        new Error(
          `Account switcher teardown failed: ${
            error instanceof Error ? error.message : String(error)
          }`
        )
    }
  }

  ledger.push(
    routeError === null && row !== null
      ? row
      : await failedRouteRow(
          page,
          options,
          surface.id,
          routeError ?? new Error('The account switcher route produced no row.')
        )
  )
}

async function auditWorkflowManagerAndCatalog(page, session, options, ledger) {
  const managerSurface = requiredNestedRoute(
    'repository.actions.workflow-manager'
  )
  const catalogSurface = requiredNestedRoute(
    'repository.actions.workflow-catalog'
  )
  const actions = page.locator(managerSurface.ownerSelector).last()
  const manager = page.locator(managerSurface.selector).last()
  const catalogDialog = page.locator(catalogSurface.selector).last()
  const managerTrigger = actions.getByRole('button', {
    name: 'Manage workflows',
    exact: true,
  })
  let managerRow = null
  let catalogRow = null
  let managerError = null
  let catalogError = null

  try {
    await actions.waitFor({ state: 'visible', timeout: 10_000 })
    await managerTrigger.waitFor({ state: 'visible', timeout: 10_000 })
    if (await manager.isVisible().catch(() => false)) {
      fail('The workflow manager was already open before its audit route.')
    }
    await managerTrigger.click()
    await manager.waitFor({ state: 'visible', timeout: 10_000 })
    await manager
      .locator('.actions-workflow-row')
      .first()
      .waitFor({ state: 'visible', timeout: 30_000 })
    managerRow = await safeAuditMatrix(
      page,
      session,
      options,
      managerSurface.id,
      managerSurface.ownerSelector,
      managerSurface.selector
    )
  } catch (error) {
    managerError = error
  }

  try {
    await manager.waitFor({ state: 'visible', timeout: 10_000 })
    const catalogTrigger = manager.getByRole('button', {
      name: 'New workflow',
      exact: true,
    })
    await catalogTrigger.click()
    await catalogDialog.waitFor({ state: 'visible', timeout: 10_000 })
    await catalogDialog
      .locator('.workflow-template-card')
      .first()
      .waitFor({ state: 'visible', timeout: 10_000 })
    catalogRow = await safeAuditMatrix(
      page,
      session,
      options,
      catalogSurface.id,
      catalogSurface.ownerSelector,
      catalogSurface.selector
    )
  } catch (error) {
    catalogError = error
  } finally {
    try {
      if (await catalogDialog.isVisible().catch(() => false)) {
        await catalogDialog
          .getByRole('button', {
            name: 'Close new workflow dialog',
            exact: true,
          })
          .click()
        await catalogDialog.waitFor({ state: 'hidden', timeout: 10_000 })
      }
      await settle(page)
    } catch (error) {
      catalogError =
        catalogError ??
        new Error(
          `Workflow catalog teardown failed: ${
            error instanceof Error ? error.message : String(error)
          }`
        )
    }
  }

  try {
    if (await manager.isVisible().catch(() => false)) {
      await managerTrigger.click()
      await manager.waitFor({ state: 'hidden', timeout: 10_000 })
    }
    if ((await managerTrigger.getAttribute('aria-expanded')) !== 'false') {
      fail('The workflow manager route did not restore its closed state.')
    }
    await settle(page)
  } catch (error) {
    managerError =
      managerError ??
      new Error(
        `Workflow manager teardown failed: ${
          error instanceof Error ? error.message : String(error)
        }`
      )
  }

  ledger.push(
    managerError === null && managerRow !== null
      ? managerRow
      : await failedRouteRow(
          page,
          options,
          managerSurface.id,
          managerError ??
            new Error('The workflow manager route produced no row.')
        )
  )
  ledger.push(
    catalogError === null && catalogRow !== null
      ? catalogRow
      : await failedRouteRow(
          page,
          options,
          catalogSurface.id,
          catalogError ??
            new Error('The workflow catalog route produced no row.')
        )
  )
}

async function auditWorkflowDispatch(page, session, options, ledger) {
  const surface = requiredNestedRoute('repository.actions.workflow-dispatch')
  const actions = page.locator(surface.ownerSelector).last()
  const dialog = page.locator(surface.selector).last()
  const trigger = actions.getByRole('button', {
    name: 'Run workflow',
    exact: true,
  })
  let row = null
  let routeError = null

  try {
    await actions.waitFor({ state: 'visible', timeout: 10_000 })
    await trigger.waitFor({ state: 'visible', timeout: 10_000 })
    if (await dialog.isVisible().catch(() => false)) {
      fail('The workflow dispatch dialog was already open before its route.')
    }
    await trigger.click({ timeout: 30_000 })
    await dialog.waitFor({ state: 'visible', timeout: 10_000 })
    await dialog
      .locator('.actions-loading')
      .waitFor({ state: 'hidden', timeout: 30_000 })
    await dialog
      .locator('.workflow-dispatch-run-button:not([disabled])')
      .waitFor({ state: 'visible', timeout: 10_000 })
    row = await safeAuditMatrix(
      page,
      session,
      options,
      surface.id,
      surface.ownerSelector,
      surface.selector
    )
  } catch (error) {
    routeError = error
  } finally {
    try {
      if (await dialog.isVisible().catch(() => false)) {
        await dialog
          .getByRole('button', {
            name: 'Close run workflow dialog',
            exact: true,
          })
          .click()
        await dialog.waitFor({ state: 'hidden', timeout: 10_000 })
      }
      await settle(page)
    } catch (error) {
      routeError =
        routeError ??
        new Error(
          `Workflow dispatch teardown failed: ${
            error instanceof Error ? error.message : String(error)
          }`
        )
    }
  }

  ledger.push(
    routeError === null && row !== null
      ? row
      : await failedRouteRow(
          page,
          options,
          surface.id,
          routeError ??
            new Error('The workflow dispatch route produced no row.')
        )
  )
}

async function auditActionsDesignSurfaces(page, session, options, ledger) {
  await auditWorkflowManagerAndCatalog(page, session, options, ledger)
  await auditWorkflowDispatch(page, session, options, ledger)
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

    if (surface.member === 'Actions') {
      await auditActionsDesignSurfaces(page, session, options, ledger)
    }

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

function appearanceWithRunUI(receipt, runAppearance) {
  const source = receipt ?? runAppearance
  if (
    source.ui?.preferenceDialogObserved === true ||
    runAppearance.ui?.preferenceDialogObserved !== true
  ) {
    return source
  }
  return appearanceReceipt(source.requested, source.observed, runAppearance.ui)
}

function decorateLedger(
  ledger,
  metadata,
  runAppearance = appearanceReceipt(
    defaultRequestedAppearance,
    matchingObservedAppearance(defaultRequestedAppearance),
    matchingAppearanceUIReceipt(defaultRequestedAppearance)
  )
) {
  return ledger.map(row => {
    const base = metadata.get(row.id)
    const menuSurface = row.id.startsWith('menu.')
    const summaryAppearance = appearanceWithRunUI(row.appearance, runAppearance)
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
      appearance: summaryAppearance,
      attempts: row.attempts ?? [],
      evidence: (row.evidence ?? []).map(entry => ({
        ...entry,
        appearance: appearanceWithRunUI(
          entry.appearance ?? summaryAppearance,
          runAppearance
        ),
      })),
      capture: row.capture ?? null,
      notes: row.notes ?? null,
    }
  })
}

function validateAppearanceReceipt(receipt, label, requireMatch) {
  if (
    typeof receipt !== 'object' ||
    receipt === null ||
    typeof receipt.requested !== 'object' ||
    receipt.requested === null ||
    typeof receipt.observed !== 'object' ||
    receipt.observed === null ||
    typeof receipt.ui !== 'object' ||
    receipt.ui === null
  ) {
    fail(`Invalid appearance receipt for ${label}.`)
  }
  if (
    typeof receipt.requested.theme !== 'string' ||
    typeof receipt.requested.languageMode !== 'string'
  ) {
    fail(`Invalid requested appearance for ${label}.`)
  }
  parseAppearanceOptions(
    receipt.requested.theme,
    receipt.requested.languageMode
  )
  const observed = receipt.observed
  for (const field of [
    'theme',
    'languageMode',
    'persistedTheme',
    'persistedLanguageMode',
    'documentLanguageMode',
    'documentLanguage',
  ]) {
    if (observed[field] !== null && typeof observed[field] !== 'string') {
      fail(`Invalid observed ${field} for ${label}.`)
    }
  }
  if (
    !Array.isArray(observed.bodyThemeClasses) ||
    observed.bodyThemeClasses.some(value => typeof value !== 'string')
  ) {
    fail(`Invalid observed body theme classes for ${label}.`)
  }

  const ui = receipt.ui
  for (const field of [
    'preferenceDialogObserved',
    'selectObserved',
    'selectOptionsExact',
    'selectLabelAssociated',
    'selectLabelLocalized',
    'globalIgnoreObserved',
    'visibleEnglishPresent',
    'visibleCantonesePresent',
    'bilingualStructure',
    'primaryAccessibleNameMatched',
  ]) {
    if (typeof ui[field] !== 'boolean') {
      fail(`Invalid Appearance UI ${field} for ${label}.`)
    }
  }
  for (const field of ['selectValue', 'visibleMode']) {
    if (ui[field] !== null && typeof ui[field] !== 'string') {
      fail(`Invalid Appearance UI ${field} for ${label}.`)
    }
  }
  if (
    !Number.isSafeInteger(ui.selectOptionCount) ||
    ui.selectOptionCount < 0 ||
    ui.selectOptionCount > 20
  ) {
    fail(`Invalid Appearance UI selectOptionCount for ${label}.`)
  }
  if (requireMatch) {
    assertAppearanceState(receipt.requested, observed, label)
    const expectedUI = matchingAppearanceUIReceipt(receipt.requested)
    for (const [field, expected] of Object.entries(expectedUI)) {
      if (ui[field] !== expected) {
        fail(
          `${label}: persisted Appearance UI did not match ${receipt.requested.languageMode}.`
        )
      }
    }
  }
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
    validateAppearanceReceipt(
      row.appearance,
      `responsive ledger row ${row.id}`,
      row.status === 'pass'
    )
    for (const [index, evidence] of row.evidence.entries()) {
      validateAppearanceReceipt(
        evidence.appearance,
        `responsive evidence ${row.id}/${index}`,
        true
      )
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
  options.providerRemoteReceipt = ensureDirectFixtureProviderRemote(
    options.repositoryPath,
    options.providerIdentity
  )
  options.providerMutationBaseline = countProviderMutationRequests(
    options.runRoot
  )
  const fileHistoryProbe = prepareFileHistoryFixture(options.repositoryPath)
  const browser = await connect(options.port)
  const page = await getRenderer(browser)
  const session = await page.context().newCDPSession(page)
  const ledger = []
  let auditError = null
  try {
    await prepareAppearance(page, options)
    await auditBatchCloneRecoveryPopup(page, session, options, ledger)
    await prepareApp(page, options.repositoryPath)
    await observeAndAssertAppearance(page, options, 'repository preparation')
    await hydrateProviderFixture(page, options)
    await auditAppearancePreferenceUI(page, options)
    await auditAccountSwitcher(page, session, options, ledger)
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

  try {
    options.providerMutationReceipt = providerMutationReceipt(
      options.providerMutationBaseline,
      countProviderMutationRequests(options.runRoot)
    )
  } catch (error) {
    const providerError =
      error instanceof Error ? error : new Error(String(error))
    auditError =
      auditError === null
        ? providerError
        : new Error(
            `${auditError.message} Provider mutation gate also failed: ${providerError.message}`
          )
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

  const runAppearance = appearanceReceipt(
    options.requestedAppearance,
    options.observedAppearance ?? emptyObservedAppearance(),
    options.appearanceUIReceipt ?? emptyAppearanceUIReceipt()
  )
  validateAppearanceReceipt(runAppearance, 'responsive audit run', true)
  const decoratedLedger = decorateLedger(ledger, metadata, runAppearance)
  validateLedger(decoratedLedger)
  const result = {
    schemaVersion: 2,
    generatedAt: new Date().toISOString(),
    appearance: runAppearance,
    catalog: {
      schemaVersion: catalog.schemaVersion,
      viewportMatrix: catalog.viewportMatrix,
    },
    fixture: {
      fileHistoryProbe,
      provider: options.providerReceipt,
      providerRemote: options.providerRemoteReceipt,
      providerMutations: options.providerMutationReceipt,
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
  appearanceReceipt,
  assertBundledFontsLoaded,
  assertProviderReadinessLocation,
  assertAppearanceState,
  buildCatalogMetadata,
  countProviderMutationRequests,
  decorateLedger,
  ensureDirectFixtureProviderRemote,
  findGateFailures,
  matchingAppearanceUIReceipt,
  matchingObservedAppearance,
  parseAppearanceOptions,
  providerMutationReceipt,
  readProviderIdentity,
  validateProviderIdentity,
  validateAppearanceReceipt,
  validateLedger,
}
