#!/usr/bin/env node
'use strict'

/**
 * Deterministic, audit-only capture driver for the immutable Desktop Material
 * v2 design reference. Unlike the production gallery this launches a fresh
 * installed Edge/Chromium profile for every route and fulfills every remote
 * dependency from a hash-checked local asset manifest.
 *
 * The list operation deliberately has no Playwright, browser, source, asset,
 * or output dependency:
 *
 *   node capture_design_reference_cdp.js --list true
 *
 * A capture requires exactly one route or the canonical set:
 *
 *   node capture_design_reference_cdp.js --source <v2-html> --assets <cache> \
 *     --out <new-output-directory> --width 924 --height 540 \
 *     --logical-width 1240 --logical-height 725 --canonical true
 */

const crypto = require('node:crypto')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const zlib = require('node:zlib')
const { fileURLToPath, pathToFileURL } = require('node:url')

const AssetManifestFileName = 'asset-manifest.json'
const LedgerFileName = 'reference-route-ledger.json'
const SuppliedImageManifestFileName = 'design_reference_supplied_images.json'
const SuppliedImageManifestPath = path.join(
  __dirname,
  SuppliedImageManifestFileName
)
const SchemaVersion = 1
const OwnedRootPrefixes = [
  'desktop-material-ui-audit-',
  'desktop-material-p0-ui-',
]

const ExpectedSourceSha256 =
  'c7000f1f2e7276f9f0bbdcd63225d432e445e257c49fae72591df3e455a0c9ae'
const ExpectedSupportSha256 =
  'ae4f0ac8449655e17cca1e3b179effcb6817a3b0d8dc47f112a9c39c25c39fd7'
const ExpectedArchiveSha256 =
  'cdec91773d202a076d8d700491f13eb065618dc986fa4f67d6909b02b61d8f86'
const ExpectedSuppliedImageManifestSha256 =
  '76f92268a2bbfb65da757817686ac4a0b4d82f56c37458e91439af17b171b174'

const GoogleFontStylesheetUrl =
  'https://fonts.googleapis.com/css2?family=Roboto:wght@400;500;600;700&family=Roboto+Mono:wght@400;500&family=Roboto+Serif:ital,wght@0,400;0,600;1,400;1,600&family=Material+Symbols+Rounded:opsz,wght,FILL,GRAD@20..48,100..700,0..1,0&display=swap'

const RequiredPinnedUrls = Object.freeze([
  'https://unpkg.com/react@18.3.1/umd/react.production.min.js',
  'https://unpkg.com/react-dom@18.3.1/umd/react-dom.production.min.js',
  'https://unpkg.com/@babel/standalone@7.29.0/babel.min.js',
  GoogleFontStylesheetUrl,
])

const RequiredFontFamilies = Object.freeze([
  'Roboto',
  'Roboto Mono',
  'Roboto Serif',
  'Material Symbols Rounded',
])

const RegistrationComparisonThresholds = Object.freeze({
  meanAbsoluteErrorMax: 3,
  rootMeanSquareErrorMax: 10,
  differingPixelRatioAt16Max: 0.05,
})

const ExpectedSourceLabels = Object.freeze([
  'Title bar',
  'Tab strip',
  'Tab format popover',
  'App bar',
  'Navigation rail',
  'Changes panel',
  'Commit composer',
  'History panel',
  'Actions panel',
  'Workflow manager',
  'Main pane',
  'Diff pane',
  'Commit detail',
  'Workflow run detail',
  'Repository sheet',
  'Branch sheet',
  'Settings dialog',
  'Notification centre',
  'Workflow catalog',
  'Run workflow popover',
  'Clone repositories dialog',
  'Account switcher',
  'Undo history manager',
  'Regex builder',
])

const BaselineLabels = Object.freeze([
  'Title bar',
  'Tab strip',
  'App bar',
  'Navigation rail',
  'Changes panel',
  'Commit composer',
  'Main pane',
  'Diff pane',
])

function labels(...additional) {
  return [...BaselineLabels, ...additional]
}

function title(name, scopeLabel = null) {
  return { kind: 'click-title', name, scopeLabel }
}

function textButton(name, scopeLabel) {
  return { kind: 'click-text-button', name, scopeLabel }
}

function indexedCss(selector, index, description) {
  return { kind: 'click-indexed-css', selector, index, description }
}

const Routes = Object.freeze([
  {
    name: 'workspace-changes-light',
    suppliedPng: 'workspace-changes-light.png',
    theme: 'light',
    actions: [],
    expectedLabels: labels(),
  },
  {
    name: 'workspace-dark',
    suppliedPng: 'workspace-dark.png',
    theme: 'dark',
    actions: [title('Search filters', 'Changes panel')],
    expectedLabels: labels(),
  },
  {
    name: 'tab-text-style',
    suppliedPng: 'tab-text-style.png',
    theme: 'light',
    actions: [title('Tab text style')],
    expectedLabels: labels('Tab format popover'),
  },
  {
    name: 'regex-builder',
    suppliedPng: 'regex-builder.png',
    theme: 'light',
    actions: [
      title('Search filters', 'Changes panel'),
      textButton('Regex builder', 'Changes panel'),
    ],
    expectedLabels: labels('Regex builder'),
  },
  {
    name: 'settings-history-manager',
    suppliedPng: 'settings-history-manager.png',
    theme: 'light',
    actions: [title('Settings history')],
    expectedLabels: labels('Undo history manager'),
  },
  {
    name: 'settings-accounts-dark',
    suppliedPng: 'settings-accounts-dark.png',
    theme: 'dark',
    actions: [title('Settings')],
    expectedLabels: labels('Settings dialog'),
  },
  {
    name: 'history-detail',
    suppliedPng: null,
    theme: 'light',
    actions: [textButton('History', 'Navigation rail')],
    expectedLabels: [
      'Title bar',
      'Tab strip',
      'App bar',
      'Navigation rail',
      'History panel',
      'Main pane',
      'Commit detail',
    ],
  },
  {
    name: 'actions-run-detail',
    suppliedPng: null,
    theme: 'light',
    actions: [textButton('Actions', 'Navigation rail')],
    expectedLabels: [
      'Title bar',
      'Tab strip',
      'App bar',
      'Navigation rail',
      'Actions panel',
      'Main pane',
      'Workflow run detail',
    ],
  },
  {
    name: 'workflow-manager',
    suppliedPng: null,
    theme: 'light',
    actions: [
      textButton('Actions', 'Navigation rail'),
      title('Manage workflows', 'Actions panel'),
    ],
    expectedLabels: [
      'Title bar',
      'Tab strip',
      'App bar',
      'Navigation rail',
      'Actions panel',
      'Workflow manager',
      'Main pane',
      'Workflow run detail',
    ],
  },
  {
    name: 'workflow-catalog',
    suppliedPng: null,
    theme: 'light',
    actions: [
      textButton('Actions', 'Navigation rail'),
      title('Manage workflows', 'Actions panel'),
      textButton('New workflow', 'Workflow manager'),
    ],
    expectedLabels: [
      'Title bar',
      'Tab strip',
      'App bar',
      'Navigation rail',
      'Actions panel',
      'Workflow manager',
      'Main pane',
      'Workflow run detail',
      'Workflow catalog',
    ],
  },
  {
    name: 'workflow-dispatch',
    suppliedPng: null,
    theme: 'light',
    actions: [
      textButton('Actions', 'Navigation rail'),
      title('Run a workflow (workflow_dispatch)', 'Actions panel'),
    ],
    expectedLabels: [
      'Title bar',
      'Tab strip',
      'App bar',
      'Navigation rail',
      'Actions panel',
      'Main pane',
      'Workflow run detail',
      'Run workflow popover',
    ],
  },
  {
    name: 'repositories-sheet',
    suppliedPng: null,
    theme: 'light',
    actions: [
      indexedCss('button[aria-haspopup="true"]', 0, 'Open repository sheet'),
    ],
    expectedLabels: labels('Repository sheet'),
  },
  {
    name: 'branch-sheet',
    suppliedPng: null,
    theme: 'light',
    actions: [
      indexedCss('button[aria-haspopup="true"]', 1, 'Open branch sheet'),
    ],
    expectedLabels: labels('Branch sheet'),
  },
  {
    name: 'account-switcher',
    suppliedPng: null,
    theme: 'light',
    actions: [title('Switch account')],
    expectedLabels: labels('Account switcher'),
  },
  {
    name: 'notification-centre',
    suppliedPng: null,
    theme: 'light',
    actions: [title('Notifications')],
    expectedLabels: labels('Notification centre'),
  },
  {
    name: 'clone-dialog-v2',
    suppliedPng: '07-clone.png',
    suppliedPngDisposition:
      'reachable-v2-dialog-differs-from-legacy-inline-sheet',
    theme: 'light',
    actions: [
      indexedCss('button[aria-haspopup="true"]', 0, 'Open repository sheet'),
      title('Clone multiple repositories', 'Repository sheet'),
    ],
    expectedLabels: labels('Clone repositories dialog'),
  },
])

function fail(message) {
  throw new Error(message)
}

function sorted(values) {
  return [...values].sort((left, right) => left.localeCompare(right))
}

function unique(values) {
  return [...new Set(values)]
}

function sha256(buffer) {
  return crypto.createHash('sha256').update(buffer).digest('hex')
}

function canonicalLfTextBytes(buffer) {
  return Buffer.from(buffer.toString('utf8').replace(/\r\n/g, '\n'), 'utf8')
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

function strictBoolean(value, name) {
  if (value === 'true') return true
  if (value === 'false') return false
  fail(`--${name} must be true or false.`)
}

function strictDimension(value, name) {
  const parsed = Number(value)
  if (!Number.isSafeInteger(parsed) || parsed < 320 || parsed > 4096) {
    fail(`--${name} must be an integer from 320 through 4096.`)
  }
  return parsed
}

function parsePairs(argv) {
  if (argv.length % 2 !== 0) {
    fail('Every option requires an explicit value.')
  }
  const values = new Map()
  for (let index = 0; index < argv.length; index += 2) {
    const option = argv[index]
    const value = argv[index + 1]
    if (!option?.startsWith('--') || option.length < 3) {
      fail(`Invalid option near ${option ?? '<end>'}.`)
    }
    const key = option.slice(2)
    if (values.has(key)) fail(`Duplicate --${key} option.`)
    values.set(key, value)
  }
  return values
}

function routeSummary(route) {
  return {
    name: route.name,
    theme: route.theme,
    suppliedPng: route.suppliedPng,
    suppliedPngDisposition: route.suppliedPngDisposition ?? null,
    actions: route.actions.map(action => ({ ...action })),
    themePreparation: {
      registration: route.theme === 'dark' ? ['Toggle theme'] : [],
      logical: {
        light: [],
        dark: ['Toggle theme'],
      },
    },
    expectedLabels: [...route.expectedLabels],
    expectedViewport: {
      registration: {
        width: 924,
        height: 540,
        autoFit: true,
        uiScalePercent: 100,
        theme: route.theme,
      },
      logical: {
        width: 1240,
        height: 725,
        autoFit: false,
        uiScalePercent: 100,
        themes: ['light', 'dark'],
      },
    },
  }
}

function listReceipt() {
  const suppliedImages = checkedSuppliedImageManifest()
  return {
    schemaVersion: SchemaVersion,
    assetManifestFile: AssetManifestFileName,
    suppliedImageManifest: {
      file: SuppliedImageManifestFileName,
      sha256: suppliedImages.manifestHash,
      archiveSha256: suppliedImages.manifest.archiveSha256,
      imageCount: suppliedImages.manifest.images.length,
      images: suppliedImages.manifest.images,
      defaultRoot: '<source-root>/screenshots',
    },
    canonicalCount: Routes.length,
    canonicalCaptureCount: Routes.length * 3,
    canonicalRoutes: Routes.map(routeSummary),
    sourceCoverage: {
      expectedCount: ExpectedSourceLabels.length,
      expectedLabels: [...ExpectedSourceLabels],
      coveredLabels: sorted(
        unique(Routes.flatMap(route => route.expectedLabels))
      ),
      logicalLabelThemePairCount: ExpectedSourceLabels.length * 2,
      logicalThemes: ['light', 'dark'],
    },
  }
}

function validateRouteRegistry() {
  const names = Routes.map(route => route.name)
  if (unique(names).length !== names.length) fail('Route names are not unique.')
  for (const route of Routes) {
    if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(route.name)) {
      fail(`Route name is not filename-safe: ${route.name}`)
    }
    if (!['light', 'dark'].includes(route.theme)) {
      fail(`Route ${route.name} has an invalid theme.`)
    }
    if (unique(route.expectedLabels).length !== route.expectedLabels.length) {
      fail(`Route ${route.name} repeats an expected label.`)
    }
  }
  const covered = sorted(unique(Routes.flatMap(route => route.expectedLabels)))
  const expected = sorted(ExpectedSourceLabels)
  if (JSON.stringify(covered) !== JSON.stringify(expected)) {
    fail('Canonical routes do not cover the exact 24-label source contract.')
  }
}

function parseArguments(argv) {
  const values = parsePairs(argv)
  const allowed = new Set([
    'source',
    'assets',
    'supplied-images',
    'out',
    'width',
    'height',
    'logical-width',
    'logical-height',
    'list',
    'route',
    'canonical',
  ])
  for (const key of values.keys()) {
    if (!allowed.has(key)) fail(`Unsupported option --${key}.`)
  }

  if (values.has('list') && strictBoolean(values.get('list'), 'list')) {
    if (values.size !== 1) {
      fail('--list true cannot be combined with capture options.')
    }
    return { list: true }
  }

  const required = [
    'source',
    'assets',
    'out',
    'width',
    'height',
    'logical-width',
    'logical-height',
  ]
  for (const key of required) {
    if (!values.has(key)) fail(`Missing required --${key} option.`)
  }

  const canonical = values.has('canonical')
    ? strictBoolean(values.get('canonical'), 'canonical')
    : false
  const routeName = values.get('route') ?? null
  if (canonical === Boolean(routeName)) {
    fail('Choose exactly one of --canonical true or --route <name>.')
  }
  const route = routeName
    ? Routes.find(candidate => candidate.name === routeName)
    : null
  if (routeName && !route) fail(`Unknown reference route: ${routeName}.`)

  return {
    list: false,
    source: values.get('source'),
    assets: values.get('assets'),
    suppliedImages: values.get('supplied-images') ?? null,
    out: values.get('out'),
    width: strictDimension(values.get('width'), 'width'),
    height: strictDimension(values.get('height'), 'height'),
    logicalWidth: strictDimension(values.get('logical-width'), 'logical-width'),
    logicalHeight: strictDimension(
      values.get('logical-height'),
      'logical-height'
    ),
    routes: canonical ? [...Routes] : [route],
    canonical,
  }
}

validateRouteRegistry()

function firstPathSegment(root, candidate) {
  const relative = path.relative(root, candidate)
  if (
    relative === '' ||
    path.isAbsolute(relative) ||
    relative === '..' ||
    relative.startsWith(`..${path.sep}`)
  ) {
    return null
  }
  return relative.split(path.sep)[0]
}

function assertNoSymlinkSegments(root, candidate, allowMissingLeaf = false) {
  const relative = path.relative(root, candidate)
  if (!isWithin(root, candidate)) fail('Path escapes its owned root.')
  const segments = relative === '' ? [] : relative.split(path.sep)
  let current = root
  for (let index = 0; index < segments.length; index += 1) {
    current = path.join(current, segments[index])
    if (!fs.existsSync(current)) {
      if (allowMissingLeaf) return
      fail('An expected owned path does not exist.')
    }
    const stat = fs.lstatSync(current)
    if (stat.isSymbolicLink()) {
      fail('Owned paths may not contain symbolic links or junctions.')
    }
  }
}

function ownedExistingPath(requestedPath, expectedType) {
  if (!path.isAbsolute(requestedPath)) {
    fail(`${expectedType} must be an absolute path.`)
  }
  if (!fs.existsSync(requestedPath)) fail(`${expectedType} does not exist.`)
  const resolved = fs.realpathSync.native(requestedPath)
  const temp = fs.realpathSync.native(os.tmpdir())
  const first = firstPathSegment(temp, resolved)
  if (!first || !OwnedRootPrefixes.some(prefix => first.startsWith(prefix))) {
    fail(
      `${expectedType} must be beneath a named Desktop Material audit root in system Temp.`
    )
  }
  const ownedRoot = path.join(temp, first)
  assertNoSymlinkSegments(ownedRoot, resolved)
  const stat = fs.statSync(resolved)
  if (expectedType === 'source' && !stat.isFile()) {
    fail('source must be a regular file.')
  }
  if (expectedType === 'assets' && !stat.isDirectory()) {
    fail('assets must be a directory.')
  }
  if (expectedType === 'supplied-images' && !stat.isDirectory()) {
    fail('supplied-images must be a directory.')
  }
  return { resolved, ownedRoot }
}

function ownedNewOutputPath(requestedPath) {
  if (!path.isAbsolute(requestedPath)) fail('out must be an absolute path.')
  const requested = path.resolve(requestedPath)
  if (fs.existsSync(requested)) {
    fail('out must be a new path; output reuse is forbidden.')
  }
  const requestedParent = path.dirname(requested)
  if (
    !fs.existsSync(requestedParent) ||
    !fs.statSync(requestedParent).isDirectory()
  ) {
    fail('The direct parent of out must already exist.')
  }
  const realParent = fs.realpathSync.native(requestedParent)
  const normalized = path.join(realParent, path.basename(requested))
  const temp = fs.realpathSync.native(os.tmpdir())
  const first = firstPathSegment(temp, normalized)
  if (!first || !OwnedRootPrefixes.some(prefix => first.startsWith(prefix))) {
    fail(
      'out must be beneath a named Desktop Material audit root in system Temp.'
    )
  }
  const ownedRoot = path.join(temp, first)
  if (!fs.existsSync(ownedRoot)) fail('The owned output root does not exist.')
  assertNoSymlinkSegments(ownedRoot, normalized, true)

  if (!isWithin(ownedRoot, realParent))
    fail('The output parent escapes its root.')
  assertNoSymlinkSegments(ownedRoot, realParent)
  return { resolved: normalized, ownedRoot }
}

function resolveRuntimePaths(options) {
  const source = ownedExistingPath(options.source, 'source')
  const assets = ownedExistingPath(options.assets, 'assets')
  const out = ownedNewOutputPath(options.out)
  const sourceRoot = fs.realpathSync.native(path.dirname(source.resolved))
  const suppliedImages = ownedExistingPath(
    options.suppliedImages ?? path.join(sourceRoot, 'screenshots'),
    'supplied-images'
  )

  if (
    suppliedImages.resolved === sourceRoot ||
    !isWithin(sourceRoot, suppliedImages.resolved)
  ) {
    fail(
      'supplied-images must be a contained child of the immutable source root.'
    )
  }

  if (
    isWithin(sourceRoot, out.resolved) ||
    isWithin(assets.resolved, out.resolved)
  ) {
    fail('out may not be inside the immutable source or asset cache.')
  }
  if (
    isWithin(out.resolved, sourceRoot) ||
    isWithin(out.resolved, assets.resolved)
  ) {
    fail('out may not contain the immutable source or asset cache.')
  }
  return {
    sourcePath: source.resolved,
    sourceRoot,
    assetRoot: assets.resolved,
    suppliedImageRoot: suppliedImages.resolved,
    outRoot: out.resolved,
  }
}

function safeRelative(root, requested, description) {
  if (typeof requested !== 'string' || requested.length === 0) {
    fail(`${description} path must be a non-empty string.`)
  }
  if (path.isAbsolute(requested)) fail(`${description} path must be relative.`)
  const candidate = path.resolve(root, requested)
  if (!isWithin(root, candidate) || candidate === root) {
    fail(`${description} path escapes its root.`)
  }
  assertNoSymlinkSegments(root, candidate)
  const resolved = fs.realpathSync.native(candidate)
  if (!isWithin(root, resolved))
    fail(`${description} resolves outside its root.`)
  if (!fs.statSync(resolved).isFile()) fail(`${description} is not a file.`)
  return resolved
}

function readJsonObject(filePath, description) {
  let parsed
  try {
    parsed = JSON.parse(fs.readFileSync(filePath, 'utf8'))
  } catch (error) {
    fail(`${description} is not valid JSON: ${error.message}`)
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    fail(`${description} must contain a JSON object.`)
  }
  return parsed
}

function exactKeys(value, expected, description) {
  const actual = sorted(Object.keys(value))
  const wanted = sorted(expected)
  if (JSON.stringify(actual) !== JSON.stringify(wanted)) {
    fail(`${description} has unsupported or missing fields.`)
  }
}

function validSha(value, description) {
  if (typeof value !== 'string' || !/^[a-f0-9]{64}$/i.test(value)) {
    fail(`${description} must be a SHA-256 hex digest.`)
  }
  return value.toLowerCase()
}

function decodeHtmlEntities(value) {
  return value.replaceAll('&amp;', '&')
}

function staticSourceLabels(sourceText) {
  const found = []
  const pattern = /\bdata-screen-label\s*=\s*(["'])(.*?)\1/g
  for (const match of sourceText.matchAll(pattern)) found.push(match[2])
  return unique(found)
}

function validateStaticSource(sourcePath, sourceRoot) {
  const sourceBytes = fs.readFileSync(sourcePath)
  const sourceHash = sha256(sourceBytes)
  if (sourceHash !== ExpectedSourceSha256) {
    fail('source does not match the immutable archived v2 SHA-256.')
  }
  const sourceText = sourceBytes.toString('utf8')
  const observedLabels = sorted(staticSourceLabels(sourceText))
  if (
    JSON.stringify(observedLabels) !==
    JSON.stringify(sorted(ExpectedSourceLabels))
  ) {
    fail(
      'source does not expose the exact expected 24 data-screen-label values.'
    )
  }

  const supportPath = safeRelative(sourceRoot, 'support.js', 'support.js')
  const supportBytes = fs.readFileSync(supportPath)
  if (sha256(supportBytes) !== ExpectedSupportSha256) {
    fail('support.js does not match the immutable archive SHA-256.')
  }
  const supportText = supportBytes.toString('utf8')
  const injectedUrls = unique(
    [
      ...supportText.matchAll(
        /\b(?:REACT|REACT_DOM|BABEL)_URL\s*=\s*"([^"]+)"/g
      ),
    ].map(match => match[1])
  )
  const expectedScripts = RequiredPinnedUrls.filter(url =>
    url.startsWith('https://unpkg.com/')
  )
  if (
    JSON.stringify(sorted(injectedUrls)) !==
    JSON.stringify(sorted(expectedScripts))
  ) {
    fail('support.js CDN script URLs are not the exact pinned contract.')
  }

  const stylesheets = [
    ...sourceText.matchAll(
      /<link\b(?=[^>]*\brel=["']stylesheet["'])[^>]*\bhref=["']([^"']+)["'][^>]*>/gi
    ),
  ].map(match => decodeHtmlEntities(match[1]))
  if (stylesheets.length !== 1 || stylesheets[0] !== GoogleFontStylesheetUrl) {
    fail('source Google Fonts stylesheet URL is not the exact design contract.')
  }

  return {
    sourcePath,
    sourceRoot,
    sourceBytes,
    sourceHash,
    sourceText,
    supportPath,
    supportBytes,
    supportHash: sha256(supportBytes),
    observedLabels,
  }
}

function allowedRemoteResource(resource) {
  let url
  try {
    url = new URL(resource.url)
  } catch {
    fail('Every remote resource URL must be an absolute URL.')
  }
  if (url.protocol !== 'https:' || url.username || url.password || url.hash) {
    fail(
      'Remote resource URLs must be credential-free HTTPS URLs without fragments.'
    )
  }
  if (resource.kind === 'script') {
    if (
      !RequiredPinnedUrls.includes(url.href) ||
      url.hostname !== 'unpkg.com'
    ) {
      fail('Script resources must use an exact pinned support.js CDN URL.')
    }
  } else if (resource.kind === 'stylesheet') {
    if (url.href !== GoogleFontStylesheetUrl) {
      fail('The stylesheet resource must use the exact Google Fonts URL.')
    }
  } else if (resource.kind === 'font') {
    if (url.hostname !== 'fonts.gstatic.com') {
      fail('Font resources must use fonts.gstatic.com.')
    }
  } else {
    fail(`Unsupported remote resource kind: ${resource.kind}.`)
  }
  return url.href
}

function cssRemoteUrls(cssText) {
  const urls = []
  for (const match of cssText.matchAll(
    /url\(\s*(['"]?)(https:\/\/[^)'"\s]+)\1\s*\)/g
  )) {
    urls.push(match[2])
  }
  return unique(urls)
}

function validateAssetManifest(assetRoot, sourceBundle) {
  const manifestPath = safeRelative(
    assetRoot,
    AssetManifestFileName,
    'asset manifest'
  )
  const manifestBytes = fs.readFileSync(manifestPath)
  const manifest = readJsonObject(manifestPath, 'asset manifest')
  exactKeys(
    manifest,
    ['schemaVersion', 'source', 'localFiles', 'resources'],
    'asset manifest'
  )
  if (manifest.schemaVersion !== SchemaVersion) {
    fail(`asset manifest schemaVersion must be ${SchemaVersion}.`)
  }

  if (!manifest.source || typeof manifest.source !== 'object') {
    fail('asset manifest source must be an object.')
  }
  exactKeys(manifest.source, ['path', 'sha256'], 'asset manifest source')
  const manifestSourceHash = validSha(
    manifest.source.sha256,
    'asset manifest source.sha256'
  )
  if (
    manifestSourceHash !== ExpectedSourceSha256 ||
    manifestSourceHash !== sourceBundle.sourceHash
  ) {
    fail('asset manifest source hash does not match the immutable source.')
  }
  if (
    path.basename(manifest.source.path) !==
    path.basename(sourceBundle.sourcePath)
  ) {
    fail('asset manifest source path does not name the selected source.')
  }
  if (path.isAbsolute(manifest.source.path)) {
    fail('asset manifest source path must be relative.')
  }
  const selectedManifestSource = safeRelative(
    sourceBundle.sourceRoot,
    manifest.source.path,
    'asset manifest source'
  )
  if (selectedManifestSource !== sourceBundle.sourcePath) {
    fail('asset manifest source path does not resolve to the selected source.')
  }

  if (!Array.isArray(manifest.localFiles) || manifest.localFiles.length !== 1) {
    fail(
      'asset manifest must contain exactly the archived support.js local file.'
    )
  }
  const localFile = manifest.localFiles[0]
  exactKeys(localFile, ['path', 'sha256', 'kind'], 'local file entry')
  if (localFile.path !== 'support.js' || localFile.kind !== 'runtime') {
    fail('The only local file entry must be support.js with kind runtime.')
  }
  const localHash = validSha(localFile.sha256, 'support.js manifest hash')
  if (
    localHash !== ExpectedSupportSha256 ||
    localHash !== sourceBundle.supportHash
  ) {
    fail('support.js manifest hash does not match the immutable source bundle.')
  }

  if (!Array.isArray(manifest.resources) || manifest.resources.length < 8) {
    fail(
      'asset manifest resources must include scripts, CSS, and all four fonts.'
    )
  }
  const byUrl = new Map()
  const byPath = new Set()
  const resources = []
  for (const entry of manifest.resources) {
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)) {
      fail('Every asset resource must be an object.')
    }
    exactKeys(
      entry,
      ['url', 'path', 'sha256', 'contentType', 'kind', 'fontFamilies'],
      'asset resource'
    )
    if (!Array.isArray(entry.fontFamilies)) {
      fail('Every asset resource fontFamilies value must be an array.')
    }
    const url = allowedRemoteResource(entry)
    if (byUrl.has(url)) fail(`Duplicate asset URL: ${url}`)
    if (byPath.has(entry.path)) fail(`Duplicate asset path: ${entry.path}`)
    if (
      typeof entry.contentType !== 'string' ||
      !/^[a-z0-9.+-]+\/[a-z0-9.+-]+(?:;\s*charset=[a-z0-9-]+)?$/i.test(
        entry.contentType
      )
    ) {
      fail(`Invalid content type for ${url}.`)
    }
    const expectedHash = validSha(entry.sha256, `asset hash for ${url}`)
    const filePath = safeRelative(assetRoot, entry.path, `asset for ${url}`)
    const bytes = fs.readFileSync(filePath)
    const actualHash = sha256(bytes)
    if (actualHash !== expectedHash)
      fail(`Cached asset hash mismatch for ${url}.`)

    if (entry.kind === 'font') {
      if (entry.fontFamilies.length === 0) {
        fail(`Font resource ${url} must name at least one font family.`)
      }
      for (const family of entry.fontFamilies) {
        if (!RequiredFontFamilies.includes(family)) {
          fail(`Font resource ${url} names an unsupported family.`)
        }
      }
    } else if (entry.fontFamilies.length !== 0) {
      fail(`Non-font resource ${url} may not name font families.`)
    }

    const resource = {
      url,
      relativePath: entry.path.replaceAll('\\', '/'),
      sha256: actualHash,
      contentType: entry.contentType,
      kind: entry.kind,
      fontFamilies: [...entry.fontFamilies],
      bytes,
    }
    byUrl.set(url, resource)
    byPath.add(entry.path)
    resources.push(resource)
  }

  for (const requiredUrl of RequiredPinnedUrls) {
    if (!byUrl.has(requiredUrl)) {
      fail(`Asset manifest is missing required URL: ${requiredUrl}`)
    }
  }
  for (const family of RequiredFontFamilies) {
    if (
      !resources.some(
        resource =>
          resource.kind === 'font' && resource.fontFamilies.includes(family)
      )
    ) {
      fail(`Asset manifest is missing a font resource for ${family}.`)
    }
  }

  const stylesheet = byUrl.get(GoogleFontStylesheetUrl)
  const cssText = stylesheet.bytes.toString('utf8')
  for (const family of RequiredFontFamilies) {
    const declaration = new RegExp(
      `font-family\\s*:\\s*['"]?${family.replace(
        /[.*+?^${}()|[\\]\\]/g,
        '\\$&'
      )}['"]?\\s*;`,
      'i'
    )
    if (!declaration.test(cssText)) {
      fail(`Cached Google CSS does not declare ${family}.`)
    }
  }
  const cssUrls = cssRemoteUrls(cssText)
  if (cssUrls.length === 0)
    fail('Cached Google CSS does not reference font bytes.')
  for (const cssUrl of cssUrls) {
    const resource = byUrl.get(cssUrl)
    if (!resource || resource.kind !== 'font') {
      fail(`Cached Google CSS has an unmanifested font URL: ${cssUrl}`)
    }
  }
  for (const resource of resources.filter(item => item.kind === 'font')) {
    if (!cssUrls.includes(resource.url)) {
      fail(
        `Font asset is not referenced by the cached Google CSS: ${resource.url}`
      )
    }
  }

  return {
    manifest,
    manifestHash: sha256(manifestBytes),
    manifestPath,
    byUrl,
    resources,
  }
}

function installedBrowserPath() {
  const candidates = unique(
    [
      process.env.DESKTOP_MATERIAL_REFERENCE_BROWSER,
      process.env['ProgramFiles(x86)'] &&
        path.join(
          process.env['ProgramFiles(x86)'],
          'Microsoft',
          'Edge',
          'Application',
          'msedge.exe'
        ),
      process.env.ProgramFiles &&
        path.join(
          process.env.ProgramFiles,
          'Microsoft',
          'Edge',
          'Application',
          'msedge.exe'
        ),
      process.env.LOCALAPPDATA &&
        path.join(
          process.env.LOCALAPPDATA,
          'Microsoft',
          'Edge',
          'Application',
          'msedge.exe'
        ),
      process.env.ProgramFiles &&
        path.join(
          process.env.ProgramFiles,
          'Google',
          'Chrome',
          'Application',
          'chrome.exe'
        ),
      process.env['ProgramFiles(x86)'] &&
        path.join(
          process.env['ProgramFiles(x86)'],
          'Google',
          'Chrome',
          'Application',
          'chrome.exe'
        ),
      process.env.LOCALAPPDATA &&
        path.join(
          process.env.LOCALAPPDATA,
          'Chromium',
          'Application',
          'chrome.exe'
        ),
    ].filter(Boolean)
  )
  for (const candidate of candidates) {
    if (!path.isAbsolute(candidate) || !fs.existsSync(candidate)) continue
    if (
      !['msedge.exe', 'chrome.exe'].includes(
        path.basename(candidate).toLowerCase()
      )
    ) {
      continue
    }
    const stat = fs.lstatSync(candidate)
    if (!stat.isFile() || stat.isSymbolicLink()) continue
    return fs.realpathSync.native(candidate)
  }
  fail(
    'No installed Edge/Chrome/Chromium executable was found; the driver will not download a browser.'
  )
}

function browserExecutableReceipt(executablePath) {
  const basename = path.basename(executablePath).toLowerCase()
  if (!['msedge.exe', 'chrome.exe'].includes(basename)) {
    fail('Selected browser executable is not Edge/Chrome/Chromium.')
  }
  const stat = fs.statSync(executablePath)
  if (!stat.isFile() || stat.size < 1024) {
    fail('Selected browser executable is not a plausible regular file.')
  }
  return {
    basename,
    bytes: stat.size,
    sha256: sha256(fs.readFileSync(executablePath)),
  }
}

function supportedBrowserVersionReceipt(version) {
  if (!version || typeof version !== 'object') {
    fail('Browser.getVersion did not return an object.')
  }
  const product = String(version.product ?? '')
  const separator = product.indexOf('/')
  const productName = separator === -1 ? product : product.slice(0, separator)
  const productVersion = separator === -1 ? '' : product.slice(separator + 1)
  if (
    ![
      'Chrome',
      'HeadlessChrome',
      'Chromium',
      'Microsoft Edge',
      'Edge',
      'Edg',
    ].includes(productName) ||
    !/^\d+(?:\.\d+){2,3}$/.test(productVersion)
  ) {
    fail(`Unsupported Browser.getVersion product: ${product}.`)
  }
  const userAgent = String(version.userAgent ?? '')
  if (
    userAgent.length < 10 ||
    userAgent.length > 512 ||
    !/(?:Chrome|Chromium|Edg)\/\d+/i.test(userAgent) ||
    /[\r\n]|[a-z]:\\users\\/i.test(userAgent)
  ) {
    fail('Browser.getVersion returned an unsupported or private userAgent.')
  }
  const protocolVersion = String(version.protocolVersion ?? '')
  if (!/^\d+\.\d+$/.test(protocolVersion)) {
    fail('Browser.getVersion returned an invalid protocolVersion.')
  }
  return {
    product,
    productName,
    version: productVersion,
    userAgent,
    protocolVersion,
    jsVersion: String(version.jsVersion ?? ''),
  }
}

async function browserVersionReceipt(context, page) {
  const session = await context.newCDPSession(page)
  try {
    return supportedBrowserVersionReceipt(
      await session.send('Browser.getVersion')
    )
  } finally {
    await session.detach().catch(() => {})
  }
}

function diagnosticsReceipt() {
  return {
    fulfilled: [],
    localRequests: [],
    console: [],
    pageErrors: [],
    requestFailures: [],
    responseErrors: [],
    cacheMisses: [],
  }
}

function localRequestPath(url) {
  const parsed = new URL(url)
  parsed.search = ''
  parsed.hash = ''
  return fileURLToPath(parsed)
}

async function installFailClosedRouting(
  context,
  assetCache,
  suppliedImages,
  sourceRoot,
  diagnostics
) {
  context.on('requestfailed', request => {
    diagnostics.requestFailures.push({
      url: request.url(),
      method: request.method(),
      failure: request.failure()?.errorText ?? 'unknown request failure',
    })
  })
  context.on('response', response => {
    if (response.status() >= 400) {
      diagnostics.responseErrors.push({
        url: response.url(),
        status: response.status(),
      })
    }
  })

  await context.route('**/*', async route => {
    const request = route.request()
    const url = request.url()
    let parsed
    try {
      parsed = new URL(url)
    } catch {
      diagnostics.cacheMisses.push({ url, reason: 'invalid URL' })
      await route.abort('blockedbyclient')
      return
    }

    if (parsed.protocol === 'https:' || parsed.protocol === 'http:') {
      if (request.method() !== 'GET') {
        diagnostics.cacheMisses.push({
          url,
          reason: `unexpected ${request.method()} request`,
        })
        await route.abort('blockedbyclient')
        return
      }
      const resource = assetCache.byUrl.get(url)
      if (!resource) {
        diagnostics.cacheMisses.push({ url, reason: 'manifest cache miss' })
        await route.abort('blockedbyclient')
        return
      }
      diagnostics.fulfilled.push({
        url,
        status: 200,
        sha256: resource.sha256,
        kind: resource.kind,
        path: resource.relativePath,
      })
      await route.fulfill({
        status: 200,
        contentType: resource.contentType,
        headers: {
          'access-control-allow-origin': '*',
          'cache-control': 'no-store',
          'x-content-type-options': 'nosniff',
        },
        body: resource.bytes,
      })
      return
    }

    if (parsed.protocol === 'file:') {
      let requestedPath
      try {
        requestedPath = localRequestPath(url)
      } catch {
        diagnostics.cacheMisses.push({ url, reason: 'invalid file URL' })
        await route.abort('blockedbyclient')
        return
      }
      if (!fs.existsSync(requestedPath)) {
        diagnostics.cacheMisses.push({ url, reason: 'missing local file' })
        await route.abort('blockedbyclient')
        return
      }
      const resolved = fs.realpathSync.native(requestedPath)
      if (!isWithin(sourceRoot, resolved) || !fs.statSync(resolved).isFile()) {
        diagnostics.cacheMisses.push({ url, reason: 'local path escape' })
        await route.abort('blockedbyclient')
        return
      }
      assertNoSymlinkSegments(sourceRoot, resolved)
      diagnostics.localRequests.push({
        path: path.relative(sourceRoot, resolved).replaceAll('\\', '/'),
        status: 200,
        sha256: sha256(fs.readFileSync(resolved)),
      })
      await route.continue()
      return
    }

    if (parsed.protocol === 'data:' || parsed.protocol === 'blob:') {
      await route.continue()
      return
    }

    diagnostics.cacheMisses.push({
      url,
      reason: `unsupported ${parsed.protocol} request`,
    })
    await route.abort('blockedbyclient')
  })
}

function watchPage(page, diagnostics) {
  page.on('console', message => {
    diagnostics.console.push({
      type: message.type(),
      text: message.text(),
    })
  })
  page.on('pageerror', error => {
    diagnostics.pageErrors.push(error.message)
  })
}

function assertCleanDiagnostics(diagnostics, expectedResources = null) {
  const consoleFailures = diagnostics.console.filter(
    entry =>
      entry.type === 'error' ||
      /content security policy|\bcsp\b|mixed content/i.test(entry.text)
  )
  if (consoleFailures.length > 0) fail('The page emitted a console/CSP error.')
  if (diagnostics.pageErrors.length > 0) fail('The page emitted a page error.')
  if (diagnostics.requestFailures.length > 0) fail('A page request failed.')
  if (diagnostics.responseErrors.length > 0)
    fail('A page response was not successful.')
  if (diagnostics.cacheMisses.length > 0) {
    fail('A page request missed the checked asset/source cache.')
  }
  const fulfilled = new Set(diagnostics.fulfilled.map(entry => entry.url))
  for (const requiredUrl of RequiredPinnedUrls) {
    if (!fulfilled.has(requiredUrl)) {
      fail(`The page did not request required asset ${requiredUrl}.`)
    }
  }
  if (expectedResources) {
    for (const resource of expectedResources) {
      if (!fulfilled.has(resource.url)) {
        fail(`The page did not request manifested asset ${resource.url}.`)
      }
    }
  }
}

function screenLabelScope(page, label) {
  return page.locator(`[data-screen-label=${JSON.stringify(label)}]`)
}

async function exactlyOne(locator, description) {
  const count = await locator.count()
  if (count !== 1) fail(`${description} resolved to ${count} elements.`)
  return locator
}

async function performAction(page, action) {
  let locator
  if (action.kind === 'click-title') {
    const scope = action.scopeLabel
      ? screenLabelScope(page, action.scopeLabel)
      : page
    locator = scope.getByTitle(action.name, { exact: true })
  } else if (action.kind === 'click-text-button') {
    const scope = screenLabelScope(page, action.scopeLabel)
    const text = scope.getByText(action.name, { exact: true })
    locator = text.locator('xpath=ancestor::button[1]')
  } else if (action.kind === 'click-indexed-css') {
    const matches = page.locator(action.selector)
    const count = await matches.count()
    if (count <= action.index) {
      fail(`${action.description} index ${action.index} is unavailable.`)
    }
    locator = matches.nth(action.index)
  } else {
    fail(`Unsupported action kind: ${action.kind}.`)
  }
  await exactlyOne(locator, action.description ?? action.name ?? action.kind)
  await locator.click()
  await page.evaluate(
    () => new Promise(resolve => requestAnimationFrame(resolve))
  )
  return {
    ...action,
    status: 'performed',
  }
}

async function prepareLogicalScale(page) {
  const performed = []
  performed.push(await performAction(page, title('Settings')))
  performed.push(
    await performAction(page, textButton('Appearance', 'Settings dialog'))
  )
  const dialog = screenLabelScope(page, 'Settings dialog')
  const autoFitText = dialog.getByText('Auto-fit to window', { exact: true })
  await exactlyOne(autoFitText, 'Auto-fit to window label')
  const row = autoFitText.locator('xpath=ancestor::div[1]')
  const toggle = row.locator('button[role="switch"]')
  await exactlyOne(toggle, 'Auto-fit to window switch')
  const before = await toggle.getAttribute('aria-checked')
  if (before !== 'true')
    fail('The fresh reference page did not default auto-fit on.')
  await toggle.click()
  const after = await toggle.getAttribute('aria-checked')
  if (after !== 'false') fail('The logical capture could not disable auto-fit.')
  performed.push({
    kind: 'set-switch',
    name: 'Auto-fit to window',
    before,
    after,
    status: 'performed',
  })

  performed.push(
    await performAction(page, textButton('Accounts', 'Settings dialog'))
  )
  const closeText = dialog.getByText('close', { exact: true }).first()
  const closeButton = closeText.locator('xpath=ancestor::button[1]')
  await exactlyOne(closeButton, 'Settings close button')
  await closeButton.click()
  await dialog.waitFor({ state: 'detached' })
  performed.push({
    kind: 'click-symbol-button',
    name: 'Close Settings',
    status: 'performed',
  })
  return { performed, autoFitBefore: true, autoFitAfter: false }
}

async function waitForReferenceRuntime(page) {
  await page.locator('[data-screen-label="Title bar"]').waitFor({
    state: 'visible',
    timeout: 20_000,
  })
  await page.waitForFunction(
    expected =>
      expected.every(label =>
        document.querySelector(`[data-screen-label="${label}"]`)
      ),
    BaselineLabels,
    { timeout: 20_000 }
  )
}

async function fontReceipt(page) {
  const receipt = await page.evaluate(async fontFamilies => {
    const samples = {
      Roboto: 'Desktop Material',
      'Roboto Mono': 'main.tsx',
      'Roboto Serif': 'Commit history',
      'Material Symbols Rounded': 'settings',
    }
    const faceLoads = await Promise.all(
      [...document.fonts].map(async face => {
        try {
          await face.load()
          return { family: face.family, status: face.status, error: null }
        } catch (error) {
          return {
            family: face.family,
            status: face.status,
            error: error instanceof Error ? error.message : String(error),
          }
        }
      })
    )
    const loaded = {}
    for (const family of fontFamilies) {
      const declaration = `16px "${family}"`
      const faces = await document.fonts.load(declaration, samples[family])
      loaded[family] = {
        check: document.fonts.check(declaration, samples[family]),
        loadedFaceCount: faces.length,
      }
    }
    await document.fonts.ready
    return {
      status: document.fonts.status,
      families: loaded,
      faceLoads,
      faces: [...document.fonts].map(face => ({
        family: face.family,
        style: face.style,
        weight: face.weight,
        status: face.status,
      })),
    }
  }, RequiredFontFamilies)

  if (receipt.status !== 'loaded') fail('document.fonts did not reach loaded.')
  if (
    receipt.faceLoads.length === 0 ||
    receipt.faceLoads.some(face => face.status !== 'loaded' || face.error)
  ) {
    fail('One or more declared FontFace resources did not load.')
  }
  for (const family of RequiredFontFamilies) {
    const observed = receipt.families[family]
    if (!observed?.check || observed.loadedFaceCount < 1) {
      fail(`Required font family did not load: ${family}.`)
    }
    const matchingFaces = receipt.faces.filter(
      face => face.family.replaceAll(/["']/g, '') === family
    )
    if (
      matchingFaces.length === 0 ||
      !matchingFaces.some(face => face.status === 'loaded')
    ) {
      fail(`Required FontFace state is not loaded: ${family}.`)
    }
  }
  return receipt
}

async function recordMotionTokens(page) {
  const receipt = await page.evaluate(() => {
    const body = getComputedStyle(document.body)
    const customProperties = {}
    for (const name of ['--mdur', '--emph', '--spring', '--spring-fast']) {
      customProperties[name] = body.getPropertyValue(name).trim()
    }
    const keyframes = []
    let inaccessibleStyleSheets = 0
    for (const sheet of document.styleSheets) {
      let rules
      try {
        rules = sheet.cssRules
      } catch {
        inaccessibleStyleSheets += 1
        continue
      }
      for (const rule of rules) {
        if (rule.type === CSSRule.KEYFRAMES_RULE) {
          keyframes.push({ name: rule.name, cssText: rule.cssText })
        }
      }
    }
    const surfaces = [...document.querySelectorAll('[data-screen-label]')].map(
      element => {
        const computed = getComputedStyle(element)
        return {
          label: element.getAttribute('data-screen-label'),
          animationName: computed.animationName,
          animationDuration: computed.animationDuration,
          animationTimingFunction: computed.animationTimingFunction,
          transitionDuration: computed.transitionDuration,
          transitionTimingFunction: computed.transitionTimingFunction,
        }
      }
    )
    return {
      customProperties,
      keyframes,
      surfaces,
      inaccessibleStyleSheets,
    }
  })
  for (const [name, value] of Object.entries(receipt.customProperties)) {
    if (!value) fail(`Motion token ${name} was unavailable before settling.`)
  }
  if (receipt.keyframes.length === 0) {
    fail('No design keyframes were recorded before animations were disabled.')
  }
  return receipt
}

async function disableMotionAfterReceipt(page) {
  await page.addStyleTag({
    content: `
      *, *::before, *::after {
        animation-delay: 0s !important;
        animation-duration: 0s !important;
        animation-iteration-count: 1 !important;
        transition-delay: 0s !important;
        transition-duration: 0s !important;
        caret-color: transparent !important;
        scroll-behavior: auto !important;
      }
    `,
  })
  await page.evaluate(
    () =>
      new Promise(resolve =>
        requestAnimationFrame(() => requestAnimationFrame(resolve))
      )
  )
}

async function settleReferenceState(page) {
  const before = await page.evaluate(() =>
    document
      .getAnimations()
      .filter(animation => animation.playState === 'running')
      .map(animation => ({
        animationName: animation.animationName ?? null,
        currentTime: animation.currentTime,
      }))
  )
  // The archived design's longest state timer that affects a resting frame is
  // the 900 ms settings-commit pulse; route animations finish sooner.
  await page.waitForTimeout(1100)
  const after = await page.evaluate(() =>
    document
      .getAnimations()
      .filter(animation => animation.playState === 'running')
      .map(animation => ({
        animationName: animation.animationName ?? null,
        currentTime: animation.currentTime,
      }))
  )
  return {
    durationMs: 1100,
    runningAnimationsBefore: before,
    runningAnimationsAfter: after,
  }
}

async function observedPageState(page) {
  return page.evaluate(() => {
    const labels = [...document.querySelectorAll('[data-screen-label]')]
      .filter(element => {
        const style = getComputedStyle(element)
        const rect = element.getBoundingClientRect()
        return (
          style.display !== 'none' &&
          style.visibility !== 'hidden' &&
          Number(style.opacity) !== 0 &&
          rect.width > 0 &&
          rect.height > 0
        )
      })
      .map(element => element.getAttribute('data-screen-label'))
    const title = document.querySelector('[data-screen-label="Title bar"]')
    const root = title?.parentElement
    return {
      labels: [...new Set(labels)],
      theme: document.body.classList.contains('theme-dark') ? 'dark' : 'light',
      uiScale: root ? Number.parseFloat(getComputedStyle(root).zoom) : null,
      bodyText: document.body.innerText,
      viewport: { width: innerWidth, height: innerHeight },
    }
  })
}

function assertExpectedPageState(state, route, variant) {
  if (
    JSON.stringify(sorted(state.labels)) !==
    JSON.stringify(sorted(route.expectedLabels))
  ) {
    fail(`Route ${route.name} did not expose its exact expected screen labels.`)
  }
  if (state.theme !== variant.theme) {
    fail(
      `Route ${route.name} did not reach the expected ${variant.theme} theme.`
    )
  }
  if (
    state.viewport.width !== variant.width ||
    state.viewport.height !== variant.height
  ) {
    fail(`Route ${route.name} observed the wrong browser viewport.`)
  }
  const expectedScale = variant.autoFit ? Math.min(1, variant.width / 1240) : 1
  if (
    !Number.isFinite(state.uiScale) ||
    Math.abs(state.uiScale - expectedScale) > 0.001
  ) {
    fail(`Route ${route.name} observed the wrong UI scale.`)
  }
}

function assertPrivateVisibleText(bodyText, runtimePaths) {
  const normalized = bodyText.toLowerCase()
  for (const privateValue of [
    runtimePaths.sourceRoot,
    runtimePaths.assetRoot,
    runtimePaths.outRoot,
  ]) {
    if (normalized.includes(privateValue.toLowerCase())) {
      fail('Rendered output contains a private audit path.')
    }
  }
  if (/[a-z]:\\users\\[^\\\s]+/i.test(bodyText)) {
    fail('Rendered output contains a Windows user path.')
  }
  if (/(?:ghp_|github_pat_|glpat-)[a-z0-9_-]{16,}/i.test(bodyText)) {
    fail('Rendered output contains a credential-shaped value.')
  }
  const userName = os.userInfo().username
  if (
    userName.length >= 4 &&
    new RegExp(
      `\\b${userName.replace(/[.*+?^${}()|[\\]\\]/g, '\\$&')}\\b`,
      'i'
    ).test(bodyText)
  ) {
    fail('Rendered output contains the current operating-system username.')
  }
}

async function compareRastersInBrowser(
  page,
  generatedPng,
  suppliedJpeg,
  width,
  height
) {
  return page.evaluate(
    async input => {
      const decode = async (base64, type) => {
        const binary = atob(base64)
        const bytes = new Uint8Array(binary.length)
        for (let index = 0; index < binary.length; index += 1) {
          bytes[index] = binary.charCodeAt(index)
        }
        const bitmap = await createImageBitmap(new Blob([bytes], { type }))
        if (bitmap.width !== input.width || bitmap.height !== input.height) {
          bitmap.close()
          throw new Error(
            `Decoded ${type} dimensions ${bitmap.width}x${bitmap.height} drifted.`
          )
        }
        const canvas = document.createElement('canvas')
        canvas.width = input.width
        canvas.height = input.height
        const context = canvas.getContext('2d', {
          alpha: false,
          colorSpace: 'srgb',
          willReadFrequently: true,
        })
        if (!context) throw new Error('Canvas 2D context is unavailable.')
        context.drawImage(bitmap, 0, 0)
        bitmap.close()
        return context.getImageData(0, 0, input.width, input.height).data
      }

      const generated = await decode(input.generated, 'image/png')
      const supplied = await decode(input.supplied, 'image/jpeg')
      let absoluteError = 0
      let squaredError = 0
      let maximumAbsoluteError = 0
      let differingPixels = 0
      let differingPixelsAt8 = 0
      let differingPixelsAt16 = 0
      let differingPixelsAt32 = 0
      const pixels = input.width * input.height
      for (let pixel = 0; pixel < pixels; pixel += 1) {
        const offset = pixel * 4
        let pixelMaximum = 0
        for (let channel = 0; channel < 3; channel += 1) {
          const difference = Math.abs(
            generated[offset + channel] - supplied[offset + channel]
          )
          absoluteError += difference
          squaredError += difference * difference
          maximumAbsoluteError = Math.max(maximumAbsoluteError, difference)
          pixelMaximum = Math.max(pixelMaximum, difference)
        }
        if (pixelMaximum > 0) differingPixels += 1
        if (pixelMaximum > 8) differingPixelsAt8 += 1
        if (pixelMaximum > 16) differingPixelsAt16 += 1
        if (pixelMaximum > 32) differingPixelsAt32 += 1
      }
      const channelSamples = pixels * 3
      return {
        decoder: 'browser-canvas-createImageBitmap-srgb',
        width: input.width,
        height: input.height,
        pixelCount: pixels,
        meanAbsoluteError: absoluteError / channelSamples,
        rootMeanSquareError: Math.sqrt(squaredError / channelSamples),
        maximumAbsoluteError,
        differingPixelRatio: differingPixels / pixels,
        differingPixelRatioAt8: differingPixelsAt8 / pixels,
        differingPixelRatioAt16: differingPixelsAt16 / pixels,
        differingPixelRatioAt32: differingPixelsAt32 / pixels,
      }
    },
    {
      generated: generatedPng.toString('base64'),
      supplied: suppliedJpeg.toString('base64'),
      width,
      height,
    }
  )
}

function comparisonThresholdEvaluation(metrics) {
  const checks = {
    meanAbsoluteError:
      metrics.meanAbsoluteError <=
      RegistrationComparisonThresholds.meanAbsoluteErrorMax,
    rootMeanSquareError:
      metrics.rootMeanSquareError <=
      RegistrationComparisonThresholds.rootMeanSquareErrorMax,
    differingPixelRatioAt16:
      metrics.differingPixelRatioAt16 <=
      RegistrationComparisonThresholds.differingPixelRatioAt16Max,
  }
  return {
    thresholds: { ...RegistrationComparisonThresholds },
    checks,
    withinThreshold: Object.values(checks).every(Boolean),
  }
}

async function registrationComparison(
  page,
  route,
  variant,
  generatedPng,
  generatedHash,
  suppliedImages,
  runtimePaths
) {
  if (variant.name !== 'registration') {
    return { status: 'not_applicable_logical_variant' }
  }
  if (!route.suppliedPng) {
    return { status: 'not_applicable_no_supplied_raster' }
  }
  const input = suppliedImages.images.find(image => image.route === route.name)
  if (!input || input.file !== route.suppliedPng) {
    fail(
      `Registration route ${route.name} is not paired to its supplied raster.`
    )
  }
  const pairedInput = {
    file: input.file,
    bytes: input.bytes,
    sha256: input.sha256,
    extension: input.extension,
    detectedEncoding: input.detectedEncoding,
    width: input.width,
    height: input.height,
    provenance: input.provenance,
    discrepancy: input.discrepancy,
  }
  const generated = {
    sha256: generatedHash,
    encoding: 'png',
    width: variant.width,
    height: variant.height,
  }
  if (input.file === '07-clone.png') {
    return {
      status: 'classified_legacy_alternate',
      reproductionRequired: false,
      reason:
        'The supplied inline clone sheet is not route-reproducible from archived v2; the reachable v2 clone dialog is captured separately.',
      input: pairedInput,
      generated,
    }
  }
  if (variant.width !== 924 || variant.height !== 540) {
    fail('Supplied registration comparison requires a 924x540 viewport.')
  }
  const suppliedPath = safeRelative(
    runtimePaths.suppliedImageRoot,
    input.file,
    `paired supplied raster ${input.file}`
  )
  const suppliedBytes = fs.readFileSync(suppliedPath)
  if (sha256(suppliedBytes) !== input.sha256) {
    fail(`Paired supplied raster changed during capture: ${input.file}.`)
  }
  const metrics = await compareRastersInBrowser(
    page,
    generatedPng,
    suppliedBytes,
    variant.width,
    variant.height
  )
  const evaluation = comparisonThresholdEvaluation(metrics)
  return {
    status: evaluation.withinThreshold
      ? 'manual_review_required'
      : 'metrics_outside_threshold',
    reproductionRequired: true,
    input: pairedInput,
    generated,
    metrics,
    evaluation,
    reviewRequirement:
      'Original-resolution paired visual review must record match, explained difference, or rejection before reproduction is accepted.',
  }
}

const PngSignature = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])

function paeth(left, above, upperLeft) {
  const prediction = left + above - upperLeft
  const leftDistance = Math.abs(prediction - left)
  const aboveDistance = Math.abs(prediction - above)
  const upperLeftDistance = Math.abs(prediction - upperLeft)
  if (leftDistance <= aboveDistance && leftDistance <= upperLeftDistance) {
    return left
  }
  if (aboveDistance <= upperLeftDistance) return above
  return upperLeft
}

function pngChunks(buffer) {
  if (
    buffer.length < PngSignature.length ||
    !buffer.subarray(0, PngSignature.length).equals(PngSignature)
  ) {
    fail('Capture is not a PNG file.')
  }
  const chunks = []
  let offset = PngSignature.length
  while (offset + 12 <= buffer.length) {
    const length = buffer.readUInt32BE(offset)
    const type = buffer.toString('ascii', offset + 4, offset + 8)
    const dataStart = offset + 8
    const dataEnd = dataStart + length
    if (dataEnd + 4 > buffer.length)
      fail('PNG chunk exceeds the file boundary.')
    chunks.push({ type, data: buffer.subarray(dataStart, dataEnd) })
    offset = dataEnd + 4
    if (type === 'IEND') break
  }
  if (chunks.at(-1)?.type !== 'IEND' || offset !== buffer.length) {
    fail('PNG does not end with one exact IEND chunk.')
  }
  return chunks
}

function validatePng(buffer, expectedWidth, expectedHeight) {
  const chunks = pngChunks(buffer)
  const textChunks = new Set(['tEXt', 'zTXt', 'iTXt'])
  if (chunks.some(chunk => textChunks.has(chunk.type))) {
    fail('PNG contains text metadata and is not privacy-safe.')
  }
  const headers = chunks.filter(chunk => chunk.type === 'IHDR')
  if (headers.length !== 1 || headers[0].data.length !== 13) {
    fail('PNG must contain one valid IHDR chunk.')
  }
  const header = headers[0].data
  const width = header.readUInt32BE(0)
  const height = header.readUInt32BE(4)
  const bitDepth = header[8]
  const colorType = header[9]
  const compression = header[10]
  const filterMethod = header[11]
  const interlace = header[12]
  if (width !== expectedWidth || height !== expectedHeight) {
    fail(
      `PNG dimensions ${width}x${height} do not match the requested viewport.`
    )
  }
  if (
    bitDepth !== 8 ||
    ![2, 6].includes(colorType) ||
    compression !== 0 ||
    filterMethod !== 0 ||
    interlace !== 0
  ) {
    fail('PNG uses an unsupported pixel format for deterministic inspection.')
  }
  const idat = chunks.filter(chunk => chunk.type === 'IDAT')
  if (idat.length === 0) fail('PNG has no image data.')
  const encoded = Buffer.concat(idat.map(chunk => chunk.data))
  let inflated
  try {
    inflated = zlib.inflateSync(encoded)
  } catch {
    fail('PNG image data could not be decompressed.')
  }
  const channels = colorType === 6 ? 4 : 3
  const stride = width * channels
  if (inflated.length !== height * (stride + 1)) {
    fail('PNG image data length is inconsistent with IHDR.')
  }

  const previous = Buffer.alloc(stride)
  const current = Buffer.alloc(stride)
  const sampleStep = Math.max(1, Math.floor((width * height) / 200_000))
  const colors = new Set()
  let minimumLuma = 255
  let maximumLuma = 0
  let opaqueSamples = 0
  let samples = 0

  for (let row = 0; row < height; row += 1) {
    const rowStart = row * (stride + 1)
    const filter = inflated[rowStart]
    if (filter > 4) fail('PNG uses an invalid scanline filter.')
    for (let index = 0; index < stride; index += 1) {
      const raw = inflated[rowStart + 1 + index]
      const left = index >= channels ? current[index - channels] : 0
      const above = previous[index]
      const upperLeft = index >= channels ? previous[index - channels] : 0
      let reconstructed
      if (filter === 0) reconstructed = raw
      else if (filter === 1) reconstructed = raw + left
      else if (filter === 2) reconstructed = raw + above
      else if (filter === 3)
        reconstructed = raw + Math.floor((left + above) / 2)
      else reconstructed = raw + paeth(left, above, upperLeft)
      current[index] = reconstructed & 0xff
    }

    for (let column = 0; column < width; column += sampleStep) {
      const pixel = column * channels
      const red = current[pixel]
      const green = current[pixel + 1]
      const blue = current[pixel + 2]
      const alpha = channels === 4 ? current[pixel + 3] : 255
      const luma = Math.round((red * 299 + green * 587 + blue * 114) / 1000)
      colors.add(`${red},${green},${blue},${alpha}`)
      minimumLuma = Math.min(minimumLuma, luma)
      maximumLuma = Math.max(maximumLuma, luma)
      if (alpha >= 250) opaqueSamples += 1
      samples += 1
    }
    previous.set(current)
  }

  const metrics = {
    width,
    height,
    bitDepth,
    colorType,
    sampledColors: colors.size,
    sampledLumaRange: maximumLuma - minimumLuma,
    opaqueSampleRatio: samples === 0 ? 0 : opaqueSamples / samples,
    bytes: buffer.length,
  }
  if (
    colors.size < 16 ||
    metrics.sampledLumaRange < 8 ||
    metrics.opaqueSampleRatio < 0.5 ||
    buffer.length < 4096
  ) {
    fail('PNG is blank, transparent, or implausibly small.')
  }
  return metrics
}

const JpegStartOfFrameMarkers = new Set([
  0xc0, 0xc1, 0xc2, 0xc3, 0xc5, 0xc6, 0xc7, 0xc9, 0xca, 0xcb, 0xcd, 0xce, 0xcf,
])

function validateJpegJfif(buffer, expectedWidth, expectedHeight, signatureHex) {
  if (
    buffer.length < 32 ||
    buffer.subarray(0, signatureHex.length / 2).toString('hex') !== signatureHex
  ) {
    fail('Supplied .png artifact does not have its pinned JPEG/JFIF signature.')
  }
  if (buffer.at(-2) !== 0xff || buffer.at(-1) !== 0xd9) {
    fail('Supplied JPEG/JFIF artifact does not end with EOI.')
  }

  let offset = 2
  let sawJfif = false
  let sawEnd = false
  let dimensions = null
  while (offset < buffer.length) {
    if (buffer[offset] !== 0xff) {
      fail('Supplied JPEG/JFIF marker structure is invalid.')
    }
    let markerOffset = offset
    while (buffer[markerOffset] === 0xff) markerOffset += 1
    const marker = buffer[markerOffset]
    offset = markerOffset + 1
    if (marker === 0xd9) {
      sawEnd = true
      break
    }
    if (marker === 0x00 || marker === 0xd8) {
      fail('Supplied JPEG/JFIF contains an invalid top-level marker.')
    }
    if (marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) continue
    if (offset + 2 > buffer.length) fail('Supplied JPEG segment is truncated.')
    const segmentLength = buffer.readUInt16BE(offset)
    if (segmentLength < 2 || offset + segmentLength > buffer.length) {
      fail('Supplied JPEG segment length is invalid.')
    }
    const payloadStart = offset + 2
    const payloadEnd = offset + segmentLength
    const payload = buffer.subarray(payloadStart, payloadEnd)
    if (
      marker === 0xe0 &&
      payload.subarray(0, 5).toString('ascii') === 'JFIF\0'
    ) {
      sawJfif = true
    }
    if (marker === 0xfe) fail('Supplied JPEG contains comment metadata.')
    if (
      marker === 0xe1 &&
      payload.subarray(0, 6).toString('ascii') === 'Exif\0\0'
    ) {
      fail('Supplied JPEG contains EXIF metadata.')
    }
    if (JpegStartOfFrameMarkers.has(marker)) {
      if (payload.length < 6) fail('Supplied JPEG SOF segment is truncated.')
      if (dimensions) fail('Supplied JPEG contains multiple SOF dimensions.')
      dimensions = {
        encoding: 'jpeg',
        container: 'jfif',
        width: payload.readUInt16BE(3),
        height: payload.readUInt16BE(1),
        precision: payload[0],
        components: payload[5],
        progressive: marker === 0xc2,
      }
    }
    offset = payloadEnd
    if (marker === 0xda) {
      while (offset < buffer.length - 1) {
        if (buffer[offset] !== 0xff) {
          offset += 1
          continue
        }
        const next = buffer[offset + 1]
        if (next === 0x00 || (next >= 0xd0 && next <= 0xd7)) {
          offset += 2
          continue
        }
        break
      }
    }
  }
  if (!sawJfif || !sawEnd || !dimensions) {
    fail('Supplied artifact is not a complete JPEG/JFIF image.')
  }
  if (
    dimensions.width !== expectedWidth ||
    dimensions.height !== expectedHeight
  ) {
    fail(
      `Supplied JPEG dimensions ${dimensions.width}x${dimensions.height} do not match 924x540.`
    )
  }
  return dimensions
}

function checkedSuppliedImageManifest() {
  if (!fs.existsSync(SuppliedImageManifestPath)) {
    fail('The checked supplied-image manifest is missing.')
  }
  const bytes = fs.readFileSync(SuppliedImageManifestPath)
  // Git for Windows may materialize this JSON text with CRLF even though its
  // immutable, checked-in content is LF. Verify the canonical text bytes so
  // the provenance contract stays stable across supported Windows checkouts.
  const manifestHash = sha256(canonicalLfTextBytes(bytes))
  if (manifestHash !== ExpectedSuppliedImageManifestSha256) {
    fail('The checked supplied-image manifest SHA-256 has drifted.')
  }
  const manifest = readJsonObject(
    SuppliedImageManifestPath,
    'checked supplied-image manifest'
  )
  exactKeys(
    manifest,
    ['schemaVersion', 'archiveSha256', 'fileContract', 'images'],
    'checked supplied-image manifest'
  )
  if (manifest.schemaVersion !== SchemaVersion) {
    fail(`supplied-image manifest schemaVersion must be ${SchemaVersion}.`)
  }
  if (
    validSha(manifest.archiveSha256, 'archive SHA-256') !==
    ExpectedArchiveSha256
  ) {
    fail('The supplied-image manifest names the wrong design archive.')
  }
  if (!manifest.fileContract || typeof manifest.fileContract !== 'object') {
    fail('The supplied-image manifest fileContract must be an object.')
  }
  exactKeys(
    manifest.fileContract,
    [
      'extension',
      'detectedEncoding',
      'container',
      'signatureHex',
      'discrepancy',
    ],
    'supplied-image file contract'
  )
  const expectedFileContract = {
    extension: '.png',
    detectedEncoding: 'jpeg',
    container: 'jfif',
    signatureHex: 'ffd8ffe000104a4649460001',
    discrepancy: 'png-extension-with-jpeg-jfif-bytes',
  }
  if (
    JSON.stringify(manifest.fileContract) !==
    JSON.stringify(expectedFileContract)
  ) {
    fail('The supplied-image encoding discrepancy contract has drifted.')
  }
  if (!Array.isArray(manifest.images) || manifest.images.length !== 7) {
    fail('The supplied-image manifest must contain exactly seven images.')
  }

  const files = new Set()
  const routes = new Set()
  const hashes = new Set()
  for (const image of manifest.images) {
    if (!image || typeof image !== 'object' || Array.isArray(image)) {
      fail('Every supplied-image entry must be an object.')
    }
    exactKeys(
      image,
      ['file', 'bytes', 'sha256', 'width', 'height', 'route', 'provenance'],
      'supplied-image entry'
    )
    if (!/^[a-z0-9][a-z0-9.-]*\.png$/.test(image.file)) {
      fail('A supplied-image filename is not allowlisted.')
    }
    if (files.has(image.file)) fail('Supplied-image filenames must be unique.')
    files.add(image.file)
    if (!Number.isSafeInteger(image.bytes) || image.bytes < 4096) {
      fail(`Supplied-image byte count is invalid for ${image.file}.`)
    }
    image.sha256 = validSha(image.sha256, `supplied image ${image.file}`)
    if (hashes.has(image.sha256)) fail('Supplied-image hashes must be unique.')
    hashes.add(image.sha256)
    if (image.width !== 924 || image.height !== 540) {
      fail(`Supplied image ${image.file} must be exactly 924x540.`)
    }
    const route = Routes.find(candidate => candidate.name === image.route)
    if (!route || route.suppliedPng !== image.file) {
      fail(`Supplied image ${image.file} is not bound to its capture route.`)
    }
    if (routes.has(image.route)) fail('Supplied-image routes must be unique.')
    routes.add(image.route)
    const expectedProvenance =
      image.file === '07-clone.png'
        ? 'legacy-inline-sheet-not-route-reproducible-from-v2'
        : 'reachable-v2-registration'
    if (image.provenance !== expectedProvenance) {
      fail(`Supplied image ${image.file} has the wrong provenance.`)
    }
  }

  const expectedFiles = sorted(
    Routes.filter(route => route.suppliedPng).map(route => route.suppliedPng)
  )
  if (JSON.stringify(sorted(files)) !== JSON.stringify(expectedFiles)) {
    fail(
      'The supplied-image manifest does not match the exact route image set.'
    )
  }
  return { manifest, manifestHash }
}

function validateSuppliedImageRoot(imageRoot, checkedManifest) {
  const entries = fs.readdirSync(imageRoot, { withFileTypes: true })
  if (entries.some(entry => !entry.isFile() || entry.isSymbolicLink())) {
    fail('The supplied-image root may contain only regular image files.')
  }
  const actualFiles = sorted(entries.map(entry => entry.name))
  const expectedFiles = sorted(
    checkedManifest.manifest.images.map(image => image.file)
  )
  if (JSON.stringify(actualFiles) !== JSON.stringify(expectedFiles)) {
    fail('The supplied-image root does not contain the exact seven-file set.')
  }

  const receipts = []
  for (const expected of checkedManifest.manifest.images) {
    const filePath = safeRelative(
      imageRoot,
      expected.file,
      `supplied image ${expected.file}`
    )
    const bytes = fs.readFileSync(filePath)
    if (bytes.length !== expected.bytes) {
      fail(`Supplied image byte count drifted for ${expected.file}.`)
    }
    const actualHash = sha256(bytes)
    if (actualHash !== expected.sha256) {
      fail(`Supplied image SHA-256 drifted for ${expected.file}.`)
    }
    const contract = checkedManifest.manifest.fileContract
    if (path.extname(expected.file) !== contract.extension) {
      fail(`Supplied image extension drifted for ${expected.file}.`)
    }
    const raster = validateJpegJfif(
      bytes,
      expected.width,
      expected.height,
      contract.signatureHex
    )
    receipts.push({
      file: expected.file,
      bytes: bytes.length,
      sha256: actualHash,
      extension: contract.extension,
      detectedEncoding: raster.encoding,
      container: raster.container,
      signatureHex: contract.signatureHex,
      discrepancy: contract.discrepancy,
      width: raster.width,
      height: raster.height,
      route: expected.route,
      provenance: expected.provenance,
      jpeg: {
        precision: raster.precision,
        components: raster.components,
        progressive: raster.progressive,
      },
    })
  }
  return {
    manifestFile: SuppliedImageManifestFileName,
    manifestSha256: checkedManifest.manifestHash,
    archiveSha256: checkedManifest.manifest.archiveSha256,
    imageCount: receipts.length,
    images: receipts,
    clone: receipts.find(receipt => receipt.file === '07-clone.png'),
  }
}

function outputFileName(route, variant) {
  const suffix =
    variant.name === 'registration' ? '' : `-logical-${variant.theme}`
  const fileName = `${route.name}${suffix}.png`
  if (!/^[a-z0-9]+(?:-[a-z0-9]+)*\.png$/.test(fileName)) {
    fail(`Output filename is not allowlisted: ${fileName}`)
  }
  return fileName
}

function writeExclusive(filePath, bytes) {
  fs.writeFileSync(filePath, bytes, { flag: 'wx', mode: 0o600 })
  const written = fs.readFileSync(filePath)
  if (!written.equals(bytes)) fail('Exclusive output verification failed.')
}

function variants(options, route) {
  return [
    {
      name: 'registration',
      width: options.width,
      height: options.height,
      autoFit: true,
      uiScalePercent: 100,
      theme: route.theme,
    },
    {
      name: 'logical-light',
      width: options.logicalWidth,
      height: options.logicalHeight,
      autoFit: false,
      uiScalePercent: 100,
      theme: 'light',
    },
    {
      name: 'logical-dark',
      width: options.logicalWidth,
      height: options.logicalHeight,
      autoFit: false,
      uiScalePercent: 100,
      theme: 'dark',
    },
  ]
}

function logicalLabelThemePairs(routes) {
  const pairs = []
  for (const theme of ['light', 'dark']) {
    for (const label of unique(routes.flatMap(route => route.expectedLabels))) {
      pairs.push({ label, theme })
    }
  }
  return pairs.sort((left, right) =>
    `${left.theme}\0${left.label}`.localeCompare(
      `${right.theme}\0${right.label}`
    )
  )
}

function assertLogicalLabelThemeCoverage(routes, captures) {
  const expected = logicalLabelThemePairs(routes)
  const observed = []
  for (const capture of captures.filter(item =>
    item.variant?.startsWith('logical-')
  )) {
    if (capture.failures?.length) continue
    for (const label of capture.observed.labels) {
      observed.push({ label, theme: capture.observed.theme })
    }
  }
  const uniqueObserved = unique(
    observed.map(pair => `${pair.theme}\0${pair.label}`)
  )
    .map(pair => {
      const [theme, label] = pair.split('\0')
      return { label, theme }
    })
    .sort((left, right) =>
      `${left.theme}\0${left.label}`.localeCompare(
        `${right.theme}\0${right.label}`
      )
    )
  if (JSON.stringify(uniqueObserved) !== JSON.stringify(expected)) {
    fail('Logical captures do not prove the exact label-by-theme matrix.')
  }
  return {
    expectedPairCount: expected.length,
    observedPairCount: uniqueObserved.length,
    themes: ['light', 'dark'],
    pairs: uniqueObserved,
  }
}

function expectedCaptureSet(options) {
  return options.routes.flatMap(route =>
    variants(options, route).map(variant => ({
      route: route.name,
      variant: variant.name,
      theme: variant.theme,
      width: variant.width,
      height: variant.height,
      png: outputFileName(route, variant),
    }))
  )
}

function assertExactCaptureSet(options, captures) {
  const expected = expectedCaptureSet(options)
  const observed = captures.map(capture => ({
    route: capture.route,
    variant: capture.variant,
    theme: capture.observed?.theme,
    width: capture.observed?.viewport?.width,
    height: capture.observed?.viewport?.height,
    png: capture.png?.path,
  }))
  if (JSON.stringify(observed) !== JSON.stringify(expected)) {
    fail('Capture output does not match the exact route/variant output set.')
  }
  return {
    expectedCount: expected.length,
    observedCount: observed.length,
    captures: observed,
  }
}

function registrationComparisonSummary(routes, captures) {
  const requiredRoutes = routes.filter(
    route => route.suppliedPng && route.suppliedPng !== '07-clone.png'
  )
  const rows = requiredRoutes.map(route => {
    const capture = captures.find(
      candidate =>
        candidate.route === route.name && candidate.variant === 'registration'
    )
    if (!capture?.comparison || !capture.comparison.input?.sha256) {
      fail(`Registration comparison is missing for ${route.name}.`)
    }
    return {
      route: route.name,
      input: capture.comparison.input,
      generated: capture.comparison.generated,
      metrics: capture.comparison.metrics,
      evaluation: capture.comparison.evaluation,
      status: capture.comparison.status,
      reviewRequirement: capture.comparison.reviewRequirement,
    }
  })
  const cloneCapture = captures.find(
    capture =>
      capture.route === 'clone-dialog-v2' && capture.variant === 'registration'
  )
  const clone = cloneCapture
    ? {
        route: cloneCapture.route,
        ...cloneCapture.comparison,
      }
    : null
  if (rows.some(row => row.status === 'metrics_outside_threshold')) {
    return {
      status: 'metrics_outside_threshold',
      requiredCount: rows.length,
      rows,
      clone,
    }
  }
  if (rows.some(row => row.status !== 'manual_review_required')) {
    fail('A reachable supplied registration has an implicit or invalid status.')
  }
  return {
    status: rows.length > 0 ? 'manual_review_required' : 'not_required',
    requiredCount: rows.length,
    rows,
    clone,
  }
}

function sanitizeFailure(error, runtimePaths) {
  let message = error instanceof Error ? error.message : String(error)
  for (const [privateValue, replacement] of [
    [runtimePaths?.sourceRoot, '<source-root>'],
    [runtimePaths?.assetRoot, '<asset-root>'],
    [runtimePaths?.outRoot, '<output-root>'],
    [os.tmpdir(), '<temp>'],
  ]) {
    if (privateValue) message = message.replaceAll(privateValue, replacement)
  }
  return message
}

function compactDiagnostics(diagnostics, runtimePaths) {
  return {
    fulfilled: diagnostics.fulfilled,
    localRequests: unique(
      diagnostics.localRequests.map(entry => JSON.stringify(entry))
    ).map(entry => JSON.parse(entry)),
    console: diagnostics.console.map(entry => ({
      ...entry,
      text: sanitizeFailure(entry.text, runtimePaths),
    })),
    pageErrors: diagnostics.pageErrors,
    requestFailures: diagnostics.requestFailures,
    responseErrors: diagnostics.responseErrors,
    cacheMisses: diagnostics.cacheMisses,
  }
}

async function captureRouteVariant({
  chromium,
  browserExecutable,
  runtimePaths,
  assetCache,
  route,
  variant,
  profileRoot,
  seenHashes,
}) {
  const diagnostics = diagnosticsReceipt()
  const profilePath = path.join(profileRoot, `${route.name}-${variant.name}`)
  fs.mkdirSync(profilePath, { recursive: false })
  let context = null
  try {
    context = await chromium.launchPersistentContext(profilePath, {
      executablePath: browserExecutable,
      headless: true,
      viewport: { width: variant.width, height: variant.height },
      deviceScaleFactor: 1,
      colorScheme: 'light',
      reducedMotion: 'no-preference',
      locale: 'en-US',
      timezoneId: 'UTC',
      serviceWorkers: 'block',
      acceptDownloads: false,
      args: [
        '--disable-background-networking',
        '--disable-component-update',
        '--disable-default-apps',
        '--disable-domain-reliability',
        '--disable-features=Translate,MediaRouter,OptimizationHints,CalculateNativeWinOcclusion',
        '--disable-gpu',
        '--disable-sync',
        '--force-device-scale-factor=1',
        '--host-resolver-rules=MAP * ~NOTFOUND',
        '--metrics-recording-only',
        '--no-first-run',
        '--no-pings',
      ],
    })
    context.setDefaultTimeout(12_000)
    await context.addInitScript(seed => {
      let state = seed >>> 0
      Math.random = () => {
        state = (Math.imul(state, 1664525) + 1013904223) >>> 0
        return state / 0x100000000
      }
    }, 0x5eed2026)
    await installFailClosedRouting(
      context,
      assetCache,
      runtimePaths.sourceRoot,
      diagnostics
    )
    const pages = context.pages()
    const page = pages[0] ?? (await context.newPage())
    const browserCdp = await browserVersionReceipt(context, page)
    watchPage(page, diagnostics)
    await page.goto(pathToFileURL(runtimePaths.sourcePath).href, {
      waitUntil: 'load',
      timeout: 30_000,
    })
    await waitForReferenceRuntime(page)

    const performedActions = []
    let scalePreparation = {
      performed: [],
      autoFitBefore: true,
      autoFitAfter: true,
    }
    if (!variant.autoFit) {
      scalePreparation = await prepareLogicalScale(page)
      performedActions.push(...scalePreparation.performed)
    }
    if (variant.theme === 'dark') {
      performedActions.push(await performAction(page, title('Toggle theme')))
    }
    for (const action of route.actions) {
      performedActions.push(await performAction(page, action))
    }

    await page
      .locator(
        `[data-screen-label=${JSON.stringify(route.expectedLabels.at(-1))}]`
      )
      .waitFor({ state: 'visible' })
    const fonts = await fontReceipt(page)
    const motion = await recordMotionTokens(page)
    const settle = await settleReferenceState(page)
    await disableMotionAfterReceipt(page)
    const pageState = await observedPageState(page)
    assertExpectedPageState(pageState, route, variant)
    assertPrivateVisibleText(pageState.bodyText, runtimePaths)
    assertCleanDiagnostics(diagnostics, assetCache.resources)

    const screenshot = await page.screenshot({
      type: 'png',
      fullPage: false,
      animations: 'disabled',
      caret: 'hide',
      scale: 'css',
    })
    assertCleanDiagnostics(diagnostics, assetCache.resources)
    const png = validatePng(screenshot, variant.width, variant.height)
    const hash = sha256(screenshot)
    const comparison = await registrationComparison(
      page,
      route,
      variant,
      screenshot,
      hash,
      suppliedImages,
      runtimePaths
    )
    if (seenHashes.has(hash)) {
      fail(
        `Duplicate PNG frame for ${route.name}/${
          variant.name
        } and ${seenHashes.get(hash)}.`
      )
    }
    seenHashes.set(hash, `${route.name}/${variant.name}`)
    const fileName = outputFileName(route, variant)
    const filePath = path.join(runtimePaths.outRoot, fileName)
    if (!isWithin(runtimePaths.outRoot, filePath)) fail('PNG path escaped out.')
    writeExclusive(filePath, screenshot)
    const verified = validatePng(
      fs.readFileSync(filePath),
      variant.width,
      variant.height
    )

    return {
      route: route.name,
      variant: variant.name,
      suppliedPng: route.suppliedPng,
      suppliedPngDisposition: route.suppliedPngDisposition ?? null,
      expected: {
        labels: route.expectedLabels,
        theme: variant.theme,
        viewport: { width: variant.width, height: variant.height },
        autoFit: variant.autoFit,
        uiScalePercent: variant.uiScalePercent,
      },
      observed: {
        labels: pageState.labels,
        theme: pageState.theme,
        viewport: pageState.viewport,
        uiScale: pageState.uiScale,
        autoFit: scalePreparation.autoFitAfter,
      },
      actions: performedActions,
      determinism: {
        randomSeed: '0x5eed2026',
        freshPage: true,
        freshOwnedProfile: true,
        settle,
      },
      browserCdp,
      fonts,
      motion,
      resources: compactDiagnostics(diagnostics, runtimePaths),
      png: {
        path: fileName,
        sha256: hash,
        ...png,
        verifiedAfterWrite: verified,
      },
      comparison,
      failures: [],
    }
  } finally {
    if (context) await context.close().catch(() => {})
    if (fs.existsSync(profilePath)) {
      fs.rmSync(profilePath, { recursive: true, force: false })
    }
  }
}

function baseLedger(options, sourceBundle, assetCache, suppliedImages) {
  return {
    schemaVersion: SchemaVersion,
    status: 'running',
    canonical: options.canonical,
    source: {
      file: path.basename(options.source),
      sha256: sourceBundle.sourceHash,
      supportJsSha256: sourceBundle.supportHash,
      staticLabels: sourceBundle.observedLabels,
    },
    assetManifest: {
      file: AssetManifestFileName,
      sha256: assetCache.manifestHash,
      resources: assetCache.resources.map(resource => ({
        url: resource.url,
        path: resource.relativePath,
        sha256: resource.sha256,
        contentType: resource.contentType,
        kind: resource.kind,
        fontFamilies: resource.fontFamilies,
      })),
    },
    suppliedImages,
    expectedRoutes: options.routes.map(route => route.name),
    expectedCaptures: expectedCaptureSet(options),
    expectedSourceLabels: [...ExpectedSourceLabels],
    captures: [],
    failures: [],
  }
}

function writeLedger(outRoot, ledger) {
  const ledgerPath = path.join(outRoot, LedgerFileName)
  if (!isWithin(outRoot, ledgerPath)) fail('Ledger path escaped out.')
  writeExclusive(
    ledgerPath,
    Buffer.from(`${JSON.stringify(ledger, null, 2)}\n`, 'utf8')
  )
}

function consolidatedBrowserProvenance(
  initialExecutable,
  finalExecutable,
  captures
) {
  if (JSON.stringify(initialExecutable) !== JSON.stringify(finalExecutable)) {
    fail('Selected browser executable changed during the capture run.')
  }
  const observations = unique(
    captures.map(capture => JSON.stringify(capture.browserCdp))
  ).map(value => JSON.parse(value))
  if (observations.length !== 1) {
    fail('Fresh browser launches did not report one stable CDP version.')
  }
  return {
    executable: initialExecutable,
    cdp: observations[0],
    observationCount: captures.length,
    consistentAcrossFreshLaunches: true,
    freshOwnedProfilePerCapture: true,
    headless: true,
  }
}

async function runCapture(options) {
  const runtimePaths = resolveRuntimePaths(options)
  const source = validateStaticSource(
    runtimePaths.sourcePath,
    runtimePaths.sourceRoot
  )
  source.sourcePath = runtimePaths.sourcePath
  const assets = validateAssetManifest(runtimePaths.assetRoot, source)
  const suppliedImages = validateSuppliedImageRoot(
    runtimePaths.suppliedImageRoot,
    checkedSuppliedImageManifest()
  )

  fs.mkdirSync(runtimePaths.outRoot, { recursive: false })
  const profileRoot = path.join(runtimePaths.outRoot, '.profiles')
  fs.mkdirSync(profileRoot, { recursive: false })
  const ledger = baseLedger(options, source, assets, suppliedImages)
  const seenHashes = new Map()
  try {
    const browserExecutable = installedBrowserPath()
    const initialBrowserExecutable = browserExecutableReceipt(browserExecutable)
    ledger.browser = {
      executable: initialBrowserExecutable,
      cdp: null,
      status: 'pending-first-fresh-launch',
    }
    // Lazy import keeps --list true static and dependency-free.
    const { chromium } = require('playwright')
    for (const route of options.routes) {
      for (const variant of variants(options, route)) {
        try {
          ledger.captures.push(
            await captureRouteVariant({
              chromium,
              browserExecutable,
              runtimePaths,
              assetCache: assets,
              suppliedImages,
              route,
              variant,
              profileRoot,
              seenHashes,
            })
          )
        } catch (error) {
          ledger.captures.push({
            route: route.name,
            variant: variant.name,
            expected: {
              labels: route.expectedLabels,
              theme: variant.theme,
              viewport: { width: variant.width, height: variant.height },
              autoFit: variant.autoFit,
              uiScalePercent: variant.uiScalePercent,
            },
            failures: [sanitizeFailure(error, runtimePaths)],
          })
          throw error
        }
      }
    }
    ledger.logicalLabelThemeCoverage = assertLogicalLabelThemeCoverage(
      options.routes,
      ledger.captures
    )
    ledger.exactCaptureSet = assertExactCaptureSet(options, ledger.captures)
    ledger.browser = consolidatedBrowserProvenance(
      initialBrowserExecutable,
      browserExecutableReceipt(browserExecutable),
      ledger.captures
    )
    ledger.registrationComparison = registrationComparisonSummary(
      options.routes,
      ledger.captures
    )
    if (ledger.registrationComparison.status === 'metrics_outside_threshold') {
      fail('One or more supplied registration comparisons exceeded thresholds.')
    }
    ledger.status =
      ledger.registrationComparison.status === 'manual_review_required'
        ? 'manual_review_required'
        : 'pass'
    return ledger
  } catch (error) {
    ledger.status = 'fail'
    ledger.failures.push(sanitizeFailure(error, runtimePaths))
    throw Object.assign(error, { auditLedger: ledger })
  } finally {
    if (fs.existsSync(profileRoot)) {
      fs.rmSync(profileRoot, { recursive: true, force: false })
    }
    writeLedger(runtimePaths.outRoot, ledger)
  }
}

async function main() {
  const options = parseArguments(process.argv.slice(2))
  if (options.list) {
    process.stdout.write(`${JSON.stringify(listReceipt(), null, 2)}\n`)
    return
  }
  const ledger = await runCapture(options)
  process.stdout.write(
    `${JSON.stringify({
      status: ledger.status,
      routes: ledger.expectedRoutes.length,
      captures: ledger.captures.length,
      ledger: LedgerFileName,
    })}\n`
  )
}

if (require.main === module) {
  main().catch(error => {
    process.stderr.write(`Reference capture failed: ${error.message}\n`)
    process.exitCode = 1
  })
}

module.exports = {
  AssetManifestFileName,
  ExpectedArchiveSha256,
  ExpectedSourceLabels,
  ExpectedSourceSha256,
  ExpectedSupportSha256,
  ExpectedSuppliedImageManifestSha256,
  GoogleFontStylesheetUrl,
  LedgerFileName,
  RequiredFontFamilies,
  RequiredPinnedUrls,
  RegistrationComparisonThresholds,
  Routes,
  SuppliedImageManifestFileName,
  assertCleanDiagnostics,
  assertExactCaptureSet,
  assertLogicalLabelThemeCoverage,
  browserExecutableReceipt,
  checkedSuppliedImageManifest,
  comparisonThresholdEvaluation,
  cssRemoteUrls,
  isWithin,
  listReceipt,
  expectedCaptureSet,
  outputFileName,
  parseArguments,
  resolveRuntimePaths,
  registrationComparisonSummary,
  staticSourceLabels,
  supportedBrowserVersionReceipt,
  validateAssetManifest,
  validatePng,
  validateRouteRegistry,
  validateStaticSource,
  validateSuppliedImageRoot,
}
