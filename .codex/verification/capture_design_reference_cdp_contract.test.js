'use strict'

const assert = require('node:assert/strict')
const crypto = require('node:crypto')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const { spawnSync } = require('node:child_process')
const test = require('node:test')
const zlib = require('node:zlib')

const driverPath = path.join(__dirname, 'capture_design_reference_cdp.js')
const schemaPath = path.join(
  __dirname,
  'design_reference_asset_manifest.schema.json'
)
const source = fs.readFileSync(driverPath, 'utf8')
const driver = require('./capture_design_reference_cdp')

function hash(bytes) {
  return crypto.createHash('sha256').update(bytes).digest('hex')
}

function withOwnedRoot(callback) {
  const root = fs.mkdtempSync(
    path.join(os.tmpdir(), 'desktop-material-ui-audit-contract-')
  )
  try {
    return callback(root)
  } finally {
    fs.rmSync(root, { recursive: true, force: true })
  }
}

function runtimePaths(root) {
  const sourceRoot = path.join(root, 'reference')
  const assetRoot = path.join(root, 'reference-cache')
  const suppliedImageRoot = path.join(sourceRoot, 'screenshots')
  const captureParent = path.join(root, 'captures')
  fs.mkdirSync(sourceRoot)
  fs.mkdirSync(assetRoot)
  fs.mkdirSync(suppliedImageRoot)
  fs.mkdirSync(captureParent)
  const sourcePath = path.join(sourceRoot, 'Desktop Material v2.dc.html')
  fs.writeFileSync(sourcePath, '<html></html>')
  return {
    sourceRoot,
    assetRoot,
    suppliedImageRoot,
    captureParent,
    sourcePath,
    outRoot: path.join(captureParent, 'reference-captures'),
  }
}

function resource(url, relativePath, bytes, kind, fontFamilies = []) {
  return {
    url,
    path: relativePath,
    sha256: hash(bytes),
    contentType:
      kind === 'script'
        ? 'application/javascript'
        : kind === 'stylesheet'
        ? 'text/css; charset=utf-8'
        : 'font/woff2',
    kind,
    fontFamilies,
  }
}

function createAssetFixture(paths) {
  const fontDefinitions = [
    ['Roboto', 'roboto.woff2'],
    ['Roboto Mono', 'roboto-mono.woff2'],
    ['Roboto Serif', 'roboto-serif.woff2'],
    ['Material Symbols Rounded', 'material-symbols-rounded.woff2'],
  ]
  const fontResources = fontDefinitions.map(([family, fileName], index) => {
    const bytes = Buffer.from(`deterministic-font-${index}-${family}`)
    const url = `https://fonts.gstatic.com/s/desktop-material/${fileName}`
    const relativePath = `fonts/${fileName}`
    fs.mkdirSync(path.join(paths.assetRoot, 'fonts'), { recursive: true })
    fs.writeFileSync(path.join(paths.assetRoot, relativePath), bytes)
    return resource(url, relativePath, bytes, 'font', [family])
  })
  const css = Buffer.from(
    fontResources
      .map(
        item =>
          `@font-face { font-family: '${item.fontFamilies[0]}'; src: url(${item.url}) format('woff2'); }`
      )
      .join('\n')
  )
  const resources = []
  for (const [index, url] of driver.RequiredPinnedUrls.entries()) {
    if (url === driver.GoogleFontStylesheetUrl) {
      const relativePath = 'google/fonts.css'
      fs.mkdirSync(path.join(paths.assetRoot, 'google'), { recursive: true })
      fs.writeFileSync(path.join(paths.assetRoot, relativePath), css)
      resources.push(resource(url, relativePath, css, 'stylesheet'))
    } else {
      const bytes = Buffer.from(`pinned-script-${index}`)
      const relativePath = `scripts/script-${index}.js`
      fs.mkdirSync(path.join(paths.assetRoot, 'scripts'), { recursive: true })
      fs.writeFileSync(path.join(paths.assetRoot, relativePath), bytes)
      resources.push(resource(url, relativePath, bytes, 'script'))
    }
  }
  resources.push(...fontResources)

  const manifest = {
    schemaVersion: 1,
    source: {
      path: 'Desktop Material v2.dc.html',
      sha256: driver.ExpectedSourceSha256,
    },
    localFiles: [
      {
        path: 'support.js',
        sha256: driver.ExpectedSupportSha256,
        kind: 'runtime',
      },
    ],
    resources,
  }
  fs.writeFileSync(
    path.join(paths.assetRoot, driver.AssetManifestFileName),
    `${JSON.stringify(manifest, null, 2)}\n`
  )
  return manifest
}

function sourceBundle(paths) {
  return {
    sourcePath: fs.realpathSync.native(paths.sourcePath),
    sourceRoot: fs.realpathSync.native(paths.sourceRoot),
    sourceHash: driver.ExpectedSourceSha256,
    supportHash: driver.ExpectedSupportSha256,
  }
}

function writeManifest(assetRoot, manifest) {
  fs.writeFileSync(
    path.join(assetRoot, driver.AssetManifestFileName),
    `${JSON.stringify(manifest, null, 2)}\n`
  )
}

function pngChunk(type, data) {
  const header = Buffer.alloc(8)
  header.writeUInt32BE(data.length, 0)
  header.write(type, 4, 4, 'ascii')
  return Buffer.concat([header, data, Buffer.alloc(4)])
}

function testPng(width = 64, height = 64, blank = false, seed = 0x12345678) {
  const header = Buffer.alloc(13)
  header.writeUInt32BE(width, 0)
  header.writeUInt32BE(height, 4)
  header[8] = 8
  header[9] = 6
  const rows = Buffer.alloc(height * (1 + width * 4))
  let state = seed
  for (let row = 0; row < height; row += 1) {
    const start = row * (1 + width * 4)
    rows[start] = 0
    for (let column = 0; column < width; column += 1) {
      const pixel = start + 1 + column * 4
      if (!blank) state = (Math.imul(state, 1664525) + 1013904223) >>> 0
      rows[pixel] = blank ? 127 : state & 0xff
      rows[pixel + 1] = blank ? 127 : (state >>> 8) & 0xff
      rows[pixel + 2] = blank ? 127 : (state >>> 16) & 0xff
      rows[pixel + 3] = 255
    }
  }
  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    pngChunk('IHDR', header),
    pngChunk('IDAT', zlib.deflateSync(rows, { level: 0 })),
    pngChunk('IEND', Buffer.alloc(0)),
  ])
}

function jpegSegment(marker, payload) {
  const header = Buffer.alloc(4)
  header[0] = 0xff
  header[1] = marker
  header.writeUInt16BE(payload.length + 2, 2)
  return Buffer.concat([header, payload])
}

function testJpegJfif(width = 924, height = 540, seed = 0x12345678) {
  const app0 = Buffer.from([
    0x4a, 0x46, 0x49, 0x46, 0x00, 0x01, 0x01, 0x00, 0x00, 0x01, 0x00, 0x01,
    0x00, 0x00,
  ])
  const sof = Buffer.alloc(15)
  sof[0] = 8
  sof.writeUInt16BE(height, 1)
  sof.writeUInt16BE(width, 3)
  sof[5] = 3
  sof.set([1, 0x11, 0, 2, 0x11, 0, 3, 0x11, 0], 6)
  const scanHeader = Buffer.from([3, 1, 0, 2, 0, 3, 0, 0, 63, 0])
  const entropy = Buffer.alloc(5000)
  let state = seed
  for (let index = 0; index < entropy.length; index += 1) {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0
    entropy[index] = state % 250
  }
  return Buffer.concat([
    Buffer.from([0xff, 0xd8]),
    jpegSegment(0xe0, app0),
    jpegSegment(0xc0, sof),
    jpegSegment(0xda, scanHeader),
    entropy,
    Buffer.from([0xff, 0xd9]),
  ])
}

function createSuppliedImageFixture(paths) {
  const pinned = driver.checkedSuppliedImageManifest()
  const manifest = structuredClone(pinned.manifest)
  for (const [index, image] of manifest.images.entries()) {
    const bytes = testJpegJfif(924, 540, 0x12345678 + index * 7919)
    fs.writeFileSync(path.join(paths.suppliedImageRoot, image.file), bytes)
    image.bytes = bytes.length
    image.sha256 = hash(bytes)
  }
  return { manifest, manifestHash: 'test-manifest' }
}

test('--list true is static and returns the complete route contract', () => {
  const result = spawnSync(process.execPath, [driverPath, '--list', 'true'], {
    cwd: os.tmpdir(),
    encoding: 'utf8',
    env: { ...process.env, NODE_PATH: '' },
  })
  assert.equal(result.status, 0, result.stderr)
  const receipt = JSON.parse(result.stdout)
  assert.equal(receipt.canonicalCount, 16)
  assert.equal(receipt.canonicalCaptureCount, 48)
  assert.equal(receipt.sourceCoverage.expectedCount, 24)
  assert.deepEqual(
    receipt.sourceCoverage.coveredLabels,
    [...receipt.sourceCoverage.expectedLabels].sort((left, right) =>
      left.localeCompare(right)
    )
  )
  assert.equal(receipt.assetManifestFile, 'asset-manifest.json')
  assert.equal(receipt.suppliedImageManifest.imageCount, 7)
  assert.doesNotMatch(result.stderr, /playwright|browser/i)
})

test('canonical routes reproduce six reachable supplied states and classify clone', () => {
  const supplied = new Map(
    driver.Routes.filter(route => route.suppliedPng).map(route => [
      route.name,
      route.suppliedPng,
    ])
  )
  assert.deepEqual(
    [...supplied],
    [
      ['workspace-changes-light', 'workspace-changes-light.png'],
      ['workspace-dark', 'workspace-dark.png'],
      ['tab-text-style', 'tab-text-style.png'],
      ['regex-builder', 'regex-builder.png'],
      ['settings-history-manager', 'settings-history-manager.png'],
      ['settings-accounts-dark', 'settings-accounts-dark.png'],
      ['clone-dialog-v2', '07-clone.png'],
    ]
  )
  const clone = driver.Routes.find(route => route.name === 'clone-dialog-v2')
  assert.equal(
    clone.suppliedPngDisposition,
    'reachable-v2-dialog-differs-from-legacy-inline-sheet'
  )
  assert.deepEqual(
    clone.actions.map(action => action.name ?? action.description),
    ['Open repository sheet', 'Clone multiple repositories']
  )
  assert.ok(clone.expectedLabels.includes('Clone repositories dialog'))
})

test('route union covers every exact static source label with deterministic metadata', () => {
  driver.validateRouteRegistry()
  const union = [
    ...new Set(driver.Routes.flatMap(route => route.expectedLabels)),
  ].sort((left, right) => left.localeCompare(right))
  assert.deepEqual(
    union,
    [...driver.ExpectedSourceLabels].sort((left, right) =>
      left.localeCompare(right)
    )
  )
  for (const route of driver.listReceipt().canonicalRoutes) {
    assert.match(route.name, /^[a-z0-9]+(?:-[a-z0-9]+)*$/)
    assert.ok(['light', 'dark'].includes(route.theme))
    assert.equal(route.expectedViewport.registration.width, 924)
    assert.equal(route.expectedViewport.registration.height, 540)
    assert.equal(route.expectedViewport.registration.autoFit, true)
    assert.equal(route.expectedViewport.logical.width, 1240)
    assert.equal(route.expectedViewport.logical.height, 725)
    assert.equal(route.expectedViewport.logical.autoFit, false)
    assert.equal(route.expectedViewport.logical.uiScalePercent, 100)
    assert.deepEqual(route.expectedViewport.logical.themes, ['light', 'dark'])
  }
  assert.equal(
    driver.listReceipt().sourceCoverage.logicalLabelThemePairCount,
    48
  )
})

test('canonical exact set proves every logical label in light and dark', () => {
  const options = {
    routes: [...driver.Routes],
    width: 924,
    height: 540,
    logicalWidth: 1240,
    logicalHeight: 725,
  }
  const expected = driver.expectedCaptureSet(options)
  assert.equal(expected.length, 48)
  for (const route of driver.Routes) {
    const routeCaptures = expected.filter(
      capture => capture.route === route.name
    )
    assert.deepEqual(
      routeCaptures.map(capture => [capture.variant, capture.theme]),
      [
        ['registration', route.theme],
        ['logical-light', 'light'],
        ['logical-dark', 'dark'],
      ]
    )
  }

  const logicalCaptures = driver.Routes.flatMap(route =>
    ['light', 'dark'].map(theme => ({
      route: route.name,
      variant: `logical-${theme}`,
      observed: {
        labels: route.expectedLabels,
        theme,
      },
      failures: [],
    }))
  )
  const coverage = driver.assertLogicalLabelThemeCoverage(
    driver.Routes,
    logicalCaptures
  )
  assert.equal(coverage.expectedPairCount, 48)
  assert.equal(coverage.observedPairCount, 48)
  assert.throws(
    () =>
      driver.assertLogicalLabelThemeCoverage(
        driver.Routes,
        logicalCaptures.filter(capture => capture.observed.theme === 'light')
      ),
    /exact label-by-theme matrix/
  )

  for (const name of ['workspace-dark', 'settings-accounts-dark']) {
    const route = driver.Routes.find(candidate => candidate.name === name)
    assert.equal(route.theme, 'dark')
    assert.equal(
      route.actions.some(action => action.name === 'Toggle theme'),
      false,
      `${name} must leave theme ownership to its capture variant`
    )
  }
})

test('registration comparisons expose metrics and can never imply an unreviewed pass', () => {
  const within = driver.comparisonThresholdEvaluation({
    meanAbsoluteError: 2,
    rootMeanSquareError: 5,
    differingPixelRatioAt16: 0.02,
  })
  assert.equal(within.withinThreshold, true)
  const outside = driver.comparisonThresholdEvaluation({
    meanAbsoluteError: 4,
    rootMeanSquareError: 11,
    differingPixelRatioAt16: 0.06,
  })
  assert.equal(outside.withinThreshold, false)

  const routes = driver.Routes.filter(
    route => route.suppliedPng && route.suppliedPng !== '07-clone.png'
  )
  const captures = routes.map(route => ({
    route: route.name,
    variant: 'registration',
    comparison: {
      status: 'manual_review_required',
      input: {
        file: route.suppliedPng,
        sha256: '1'.repeat(64),
        width: 924,
        height: 540,
      },
      generated: {
        sha256: '2'.repeat(64),
        width: 924,
        height: 540,
      },
      metrics: {
        meanAbsoluteError: 2,
        rootMeanSquareError: 5,
        maximumAbsoluteError: 32,
        differingPixelRatio: 0.4,
        differingPixelRatioAt16: 0.02,
      },
      evaluation: within,
      reviewRequirement: 'original-resolution review',
    },
  }))
  const summary = driver.registrationComparisonSummary(routes, captures)
  assert.equal(summary.status, 'manual_review_required')
  assert.equal(summary.requiredCount, 6)
  assert.equal(summary.rows.length, 6)

  const implicitPass = structuredClone(captures)
  implicitPass[0].comparison.status = 'pass'
  assert.throws(
    () => driver.registrationComparisonSummary(routes, implicitPass),
    /implicit or invalid status/
  )
  const failed = structuredClone(captures)
  failed[0].comparison.status = 'metrics_outside_threshold'
  assert.equal(
    driver.registrationComparisonSummary(routes, failed).status,
    'metrics_outside_threshold'
  )
})

test('CLI accepts the specified route/canonical forms and rejects ambiguity', () => {
  const common = [
    '--source',
    'C:\\owned\\reference\\Desktop Material v2.dc.html',
    '--assets',
    'C:\\owned\\cache',
    '--out',
    'C:\\owned\\captures',
    '--width',
    '924',
    '--height',
    '540',
    '--logical-width',
    '1240',
    '--logical-height',
    '725',
  ]
  const one = driver.parseArguments([...common, '--route', 'regex-builder'])
  assert.equal(one.routes.length, 1)
  assert.equal(one.routes[0].name, 'regex-builder')
  const all = driver.parseArguments([...common, '--canonical', 'true'])
  assert.equal(all.routes.length, 16)
  assert.throws(
    () =>
      driver.parseArguments([
        ...common,
        '--canonical',
        'true',
        '--route',
        'regex-builder',
      ]),
    /exactly one/
  )
  assert.throws(
    () => driver.parseArguments([...common, '--route', 'missing']),
    /Unknown reference route/
  )
  assert.throws(
    () => driver.parseArguments(['--list', 'true', '--source', 'ignored']),
    /cannot be combined/
  )
  assert.throws(
    () => driver.parseArguments([...common, '--width', '923']),
    /Duplicate --width/
  )
  assert.throws(
    () =>
      driver.parseArguments(
        common
          .map(value => (value === '924' ? '0' : value))
          .concat(['--route', 'regex-builder'])
      ),
    /--width must be an integer/
  )
})

test('runtime path resolution is contained and rejects output reuse', () => {
  withOwnedRoot(root => {
    const paths = runtimePaths(root)
    const resolved = driver.resolveRuntimePaths({
      source: paths.sourcePath,
      assets: paths.assetRoot,
      out: paths.outRoot,
    })
    assert.equal(resolved.sourcePath, fs.realpathSync.native(paths.sourcePath))
    assert.equal(resolved.assetRoot, fs.realpathSync.native(paths.assetRoot))
    assert.equal(
      resolved.suppliedImageRoot,
      fs.realpathSync.native(paths.suppliedImageRoot)
    )
    assert.equal(
      resolved.outRoot,
      path.join(
        fs.realpathSync.native(path.dirname(paths.outRoot)),
        path.basename(paths.outRoot)
      )
    )

    fs.mkdirSync(paths.outRoot)
    assert.throws(
      () =>
        driver.resolveRuntimePaths({
          source: paths.sourcePath,
          assets: paths.assetRoot,
          out: paths.outRoot,
        }),
      /output reuse is forbidden/
    )
  })
})

test('runtime path resolution rejects non-owned roots and source/cache overlap', () => {
  withOwnedRoot(root => {
    const paths = runtimePaths(root)
    assert.throws(
      () =>
        driver.resolveRuntimePaths({
          source: paths.sourcePath,
          assets: paths.assetRoot,
          out: path.join(os.tmpdir(), 'not-owned-reference-captures'),
        }),
      /named Desktop Material audit root/
    )
    assert.throws(
      () =>
        driver.resolveRuntimePaths({
          source: paths.sourcePath,
          assets: paths.assetRoot,
          out: path.join(paths.assetRoot, 'output'),
        }),
      /inside the immutable source or asset cache/
    )
  })
})

test('static source validation rejects any archive-byte drift before browser use', () => {
  withOwnedRoot(root => {
    const paths = runtimePaths(root)
    fs.writeFileSync(
      path.join(paths.sourceRoot, 'support.js'),
      'drifted support'
    )
    assert.throws(
      () => driver.validateStaticSource(paths.sourcePath, paths.sourceRoot),
      /immutable archived v2 SHA-256/
    )
  })
})

test('checked supplied-image manifest pins all seven dimensions, hashes, and provenance', () => {
  const checked = driver.checkedSuppliedImageManifest()
  assert.equal(checked.manifest.archiveSha256, driver.ExpectedArchiveSha256)
  assert.equal(checked.manifest.images.length, 7)
  assert.deepEqual(checked.manifest.fileContract, {
    extension: '.png',
    detectedEncoding: 'jpeg',
    container: 'jfif',
    signatureHex: 'ffd8ffe000104a4649460001',
    discrepancy: 'png-extension-with-jpeg-jfif-bytes',
  })
  assert.equal(checked.manifestHash, driver.ExpectedSuppliedImageManifestSha256)
  const clone = checked.manifest.images.find(
    image => image.file === '07-clone.png'
  )
  assert.equal(clone.bytes, 31708)
  assert.equal(
    clone.sha256,
    '9ba0b4030efc90cb3b0f05503bbe1acc93439846720d0e54bb8427705522f03a'
  )
  assert.equal(
    clone.provenance,
    'legacy-inline-sheet-not-route-reproducible-from-v2'
  )
  for (const image of checked.manifest.images) {
    assert.equal(image.width, 924)
    assert.equal(image.height, 540)
    assert.match(image.sha256, /^[a-f0-9]{64}$/)
  }
})

test('supplied-image root accepts the exact set and fails on drift or dimensions', () => {
  withOwnedRoot(root => {
    const paths = runtimePaths(root)
    const synthetic = createSuppliedImageFixture(paths)
    const receipt = driver.validateSuppliedImageRoot(
      fs.realpathSync.native(paths.suppliedImageRoot),
      synthetic
    )
    assert.equal(receipt.imageCount, 7)
    assert.equal(receipt.images.length, 7)
    assert.equal(
      receipt.clone.provenance,
      'legacy-inline-sheet-not-route-reproducible-from-v2'
    )
    assert.equal(receipt.clone.extension, '.png')
    assert.equal(receipt.clone.detectedEncoding, 'jpeg')
    assert.equal(
      receipt.clone.discrepancy,
      'png-extension-with-jpeg-jfif-bytes'
    )

    const first = synthetic.manifest.images[0]
    const firstPath = path.join(paths.suppliedImageRoot, first.file)
    const original = fs.readFileSync(firstPath)
    fs.appendFileSync(firstPath, Buffer.from([0]))
    assert.throws(
      () =>
        driver.validateSuppliedImageRoot(
          fs.realpathSync.native(paths.suppliedImageRoot),
          synthetic
        ),
      /byte count drifted/
    )
    fs.writeFileSync(firstPath, original)

    fs.writeFileSync(path.join(paths.suppliedImageRoot, 'extra.png'), original)
    assert.throws(
      () =>
        driver.validateSuppliedImageRoot(
          fs.realpathSync.native(paths.suppliedImageRoot),
          synthetic
        ),
      /exact seven-file set/
    )
    fs.rmSync(path.join(paths.suppliedImageRoot, 'extra.png'))

    const wrongDimensions = testJpegJfif(64, 64, 0xabcdef01)
    fs.writeFileSync(firstPath, wrongDimensions)
    first.bytes = wrongDimensions.length
    first.sha256 = hash(wrongDimensions)
    assert.throws(
      () =>
        driver.validateSuppliedImageRoot(
          fs.realpathSync.native(paths.suppliedImageRoot),
          synthetic
        ),
      /JPEG dimensions/
    )
  })
})

test('a complete checked asset manifest validates without network access', () => {
  withOwnedRoot(root => {
    const paths = runtimePaths(root)
    createAssetFixture(paths)
    const cache = driver.validateAssetManifest(
      fs.realpathSync.native(paths.assetRoot),
      sourceBundle(paths)
    )
    assert.equal(cache.resources.length, 8)
    assert.deepEqual(
      new Set(cache.resources.map(item => item.kind)),
      new Set(['script', 'stylesheet', 'font'])
    )
    assert.deepEqual(
      new Set(cache.resources.flatMap(item => item.fontFamilies)),
      new Set(driver.RequiredFontFamilies)
    )
  })
})

test('asset validation fails closed on hash drift, path escape, and cache miss', () => {
  withOwnedRoot(root => {
    const paths = runtimePaths(root)
    const manifest = createAssetFixture(paths)
    manifest.resources[0].sha256 = '0'.repeat(64)
    writeManifest(paths.assetRoot, manifest)
    assert.throws(
      () =>
        driver.validateAssetManifest(
          fs.realpathSync.native(paths.assetRoot),
          sourceBundle(paths)
        ),
      /Cached asset hash mismatch/
    )

    const fresh = createAssetFixture(paths)
    fresh.resources[0].path = '../escaped.js'
    writeManifest(paths.assetRoot, fresh)
    assert.throws(
      () =>
        driver.validateAssetManifest(
          fs.realpathSync.native(paths.assetRoot),
          sourceBundle(paths)
        ),
      /path escapes its root/
    )

    const missing = createAssetFixture(paths)
    fs.rmSync(path.join(paths.assetRoot, missing.resources[0].path))
    assert.throws(
      () =>
        driver.validateAssetManifest(
          fs.realpathSync.native(paths.assetRoot),
          sourceBundle(paths)
        ),
      /expected owned path does not exist/
    )
  })
})

test('asset validation rejects unmanifested Google font URLs and source escape', () => {
  withOwnedRoot(root => {
    const paths = runtimePaths(root)
    const manifest = createAssetFixture(paths)
    const stylesheet = manifest.resources.find(
      item => item.kind === 'stylesheet'
    )
    const cssPath = path.join(paths.assetRoot, stylesheet.path)
    const css = `${fs.readFileSync(
      cssPath,
      'utf8'
    )}\n@font-face { font-family: 'Roboto'; src: url(https://fonts.gstatic.com/s/missing.woff2); }`
    fs.writeFileSync(cssPath, css)
    stylesheet.sha256 = hash(Buffer.from(css))
    writeManifest(paths.assetRoot, manifest)
    assert.throws(
      () =>
        driver.validateAssetManifest(
          fs.realpathSync.native(paths.assetRoot),
          sourceBundle(paths)
        ),
      /unmanifested font URL/
    )

    const escaped = createAssetFixture(paths)
    escaped.source.path = '../Desktop Material v2.dc.html'
    writeManifest(paths.assetRoot, escaped)
    assert.throws(
      () =>
        driver.validateAssetManifest(
          fs.realpathSync.native(paths.assetRoot),
          sourceBundle(paths)
        ),
      /source path does not resolve|path escapes/
    )
  })
})

test('network diagnostics reject console, request, response, and manifest drift', () => {
  const fulfilled = driver.RequiredPinnedUrls.map(url => ({ url, status: 200 }))
  const clean = {
    fulfilled,
    localRequests: [],
    console: [],
    pageErrors: [],
    requestFailures: [],
    responseErrors: [],
    cacheMisses: [],
  }
  driver.assertCleanDiagnostics(clean)
  assert.throws(
    () =>
      driver.assertCleanDiagnostics({
        ...clean,
        console: [{ type: 'error', text: 'boom' }],
      }),
    /console\/CSP error/
  )
  assert.throws(
    () =>
      driver.assertCleanDiagnostics({
        ...clean,
        cacheMisses: [{ url: 'https://example.invalid', reason: 'miss' }],
      }),
    /missed the checked asset/
  )
  assert.throws(
    () =>
      driver.assertCleanDiagnostics(clean, [
        { url: 'https://fonts.gstatic.com/s/not-requested.woff2' },
      ]),
    /did not request manifested asset/
  )
})

test('browser provenance pins executable bytes and accepts only Chromium CDP products', () => {
  withOwnedRoot(root => {
    const browserPath = path.join(root, 'chrome.exe')
    const bytes = Buffer.alloc(2048, 0x5a)
    fs.writeFileSync(browserPath, bytes)
    const executable = driver.browserExecutableReceipt(browserPath)
    assert.deepEqual(executable, {
      basename: 'chrome.exe',
      bytes: bytes.length,
      sha256: hash(bytes),
    })
    const unsupportedPath = path.join(root, 'browser.exe')
    fs.writeFileSync(unsupportedPath, bytes)
    assert.throws(
      () => driver.browserExecutableReceipt(unsupportedPath),
      /not Edge\/Chrome\/Chromium/
    )
  })

  const cdp = driver.supportedBrowserVersionReceipt({
    product: 'Chrome/140.0.7339.0',
    protocolVersion: '1.3',
    userAgent:
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 HeadlessChrome/140.0.0.0 Safari/537.36',
    jsVersion: '14.0.0',
  })
  assert.equal(cdp.productName, 'Chrome')
  assert.equal(cdp.version, '140.0.7339.0')
  assert.equal(cdp.protocolVersion, '1.3')
  assert.throws(
    () =>
      driver.supportedBrowserVersionReceipt({
        product: 'Firefox/140.0.0',
        protocolVersion: '1.3',
        userAgent: 'Mozilla/5.0 Firefox/140',
      }),
    /Unsupported Browser\.getVersion product/
  )
  assert.throws(
    () =>
      driver.supportedBrowserVersionReceipt({
        product: 'Chrome/140.0.7339.0',
        protocolVersion: '1.3',
        userAgent:
          'Mozilla/5.0 Chrome/140.0 C:\\Users\\private\\browser-profile',
      }),
    /private userAgent/
  )
})

test('PNG verification rejects signatures, dimensions, metadata, and blank frames', () => {
  const png = testPng()
  const metrics = driver.validatePng(png, 64, 64)
  assert.equal(metrics.width, 64)
  assert.equal(metrics.height, 64)
  assert.ok(metrics.sampledColors >= 16)
  assert.throws(
    () => driver.validatePng(Buffer.from('not png'), 64, 64),
    /not a PNG/
  )
  assert.throws(() => driver.validatePng(png, 63, 64), /dimensions/)
  assert.throws(
    () => driver.validatePng(testPng(64, 64, true), 64, 64),
    /blank/
  )

  const chunks = png.subarray(8)
  const withText = Buffer.concat([
    png.subarray(0, 8),
    chunks.subarray(0, 25),
    pngChunk('tEXt', Buffer.from('private=path')),
    chunks.subarray(25),
  ])
  assert.throws(() => driver.validatePng(withText, 64, 64), /text metadata/)
})

test('driver source locks headless fresh profiles, exclusive writes, and no downloads', () => {
  for (const contract of [
    'chromium.launchPersistentContext(profilePath',
    'headless: true',
    "require('playwright')",
    "context.route('**/*'",
    'route.fulfill({',
    '--host-resolver-rules=MAP * ~NOTFOUND',
    "session.send('Browser.getVersion')",
    'browserExecutableReceipt(browserExecutable)',
    'compareRastersInBrowser(',
    'meanAbsoluteError',
    'rootMeanSquareError',
    'maximumAbsoluteError',
    'differingPixelRatioAt16',
    "'manual_review_required'",
    "flag: 'wx'",
    'document.fonts.status',
    'document.fonts.check',
    'requestAnimationFrame(() => requestAnimationFrame(resolve))',
    'fs.rmSync(profilePath, { recursive: true, force: false })',
  ]) {
    assert.ok(source.includes(contract), `missing driver contract: ${contract}`)
  }
  assert.doesNotMatch(source, /chromium\.launch\(/)
  assert.doesNotMatch(source, /connectOverCDP/)
  assert.doesNotMatch(
    source,
    /https\.request|fetch\(|npm install|playwright install/
  )
  assert.ok(
    source.indexOf("const { chromium } = require('playwright')") >
      source.indexOf('async function runCapture(options)')
  )
})

test('asset-manifest schema is strict, path-free documentation of the runtime contract', () => {
  const schema = JSON.parse(fs.readFileSync(schemaPath, 'utf8'))
  assert.equal(schema.properties.schemaVersion.const, 1)
  assert.equal(schema.additionalProperties, false)
  assert.deepEqual(schema.required, [
    'schemaVersion',
    'source',
    'localFiles',
    'resources',
  ])
  assert.equal(schema.properties.resources.minItems, 8)
  assert.equal(schema.properties.resources.items.additionalProperties, false)
  assert.doesNotMatch(
    JSON.stringify(schema),
    /C:\\Users|AppData|desktop-material-ui-audit-20260720/
  )
})
