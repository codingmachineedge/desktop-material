'use strict'

const assert = require('node:assert/strict')
const fs = require('fs')
const os = require('os')
const path = require('path')
const { describe, it } = require('node:test')
const zlib = require('zlib')

const {
  BaseModels,
  CaptureHeight,
  CaptureWidth,
  FinalSurfaceExpression,
  ProviderId,
  ProviderName,
  assertAudit,
  assertCanonicalFixtureState,
  assertFinalSurface,
  inspectPngBytes,
  parseArgumentPairs,
  parseArguments,
  parseLoopbackURL,
  providerModelsExpression,
  readOwnedOllamaFixture,
  readOwnedP0Fixture,
  validateCDPTarget,
  validateOwnedOutput,
} = require('./verify_ollama_manager_cdp.js')

function writeJSON(file, value) {
  fs.writeFileSync(file, `${JSON.stringify(value, null, 2)}\n`)
}

function withOwnedFixtures(run) {
  const p0Root = fs.mkdtempSync(
    path.join(os.tmpdir(), 'desktop-material-p0-ui-contract-')
  )
  const ollamaRoot = fs.mkdtempSync(
    path.join(os.tmpdir(), 'desktop-material-ollama-contract-')
  )
  try {
    fs.mkdirSync(path.join(p0Root, 'fixture'))
    fs.mkdirSync(path.join(p0Root, 'provider'))
    fs.mkdirSync(path.join(p0Root, 'captures'))
    writeJSON(path.join(p0Root, 'provider', 'ready.json'), {
      pid: 1001,
      bind: '127.0.0.1',
      port: 41231,
      endpoint: 'http://localhost:41231/api/v3',
      copilotEnabled: true,
      owner: 'material-fixture-owner',
      repository: 'material-fixture',
      accountLogin: 'material-verifier-p0',
      accountId: 7130701,
    })

    fs.mkdirSync(path.join(ollamaRoot, 'ollama'))
    writeJSON(path.join(ollamaRoot, 'ollama', 'ready.json'), {
      fixture: 'desktop-material-ollama',
      protocolVersion: 1,
      pid: 1002,
      bind: '127.0.0.1',
      port: 41232,
      endpoint: 'http://127.0.0.1:41232',
      version: '0.12.6',
      runRootName: path.basename(ollamaRoot),
      mutationLog: 'ollama/mutations.jsonl',
      faultMode: 'none',
      minimumPullDurationMs: 4200,
      seedModels: [...BaseModels],
      runningModels: ['material-chat:7b'],
      pullableModels: ['material-code:1.5b'],
    })
    fs.writeFileSync(path.join(ollamaRoot, 'ollama', 'mutations.jsonl'), '')
    return run({ p0Root, ollamaRoot })
  } finally {
    fs.rmSync(p0Root, { recursive: true, force: true })
    fs.rmSync(ollamaRoot, { recursive: true, force: true })
  }
}

function pngChunk(type, data) {
  const result = Buffer.alloc(12 + data.length)
  result.writeUInt32BE(data.length, 0)
  result.write(type, 4, 4, 'ascii')
  data.copy(result, 8)
  // The verifier does not need to reimplement the PNG CRC gate. Chromium owns
  // the actual encoded file, while this unit fixture targets scanline decoding.
  result.writeUInt32BE(0, 8 + data.length)
  return result
}

function makeRgbPng(width, height, pixel) {
  const header = Buffer.alloc(13)
  header.writeUInt32BE(width, 0)
  header.writeUInt32BE(height, 4)
  header[8] = 8
  header[9] = 2
  const rows = []
  for (let y = 0; y < height; y++) {
    const row = Buffer.alloc(1 + width * 3)
    row[0] = 0
    for (let x = 0; x < width; x++) {
      const [red, green, blue] = pixel(x, y)
      row[1 + x * 3] = red
      row[2 + x * 3] = green
      row[3 + x * 3] = blue
    }
    rows.push(row)
  }
  return Buffer.concat([
    Buffer.from('89504e470d0a1a0a', 'hex'),
    pngChunk('IHDR', header),
    pngChunk('IDAT', zlib.deflateSync(Buffer.concat(rows))),
    pngChunk('IEND', Buffer.alloc(0)),
  ])
}

function validSurface() {
  const verification = [
    'ollama-refresh',
    'ollama-pull-name',
    'ollama-pull',
    'ollama-filter',
    'ollama-scope',
    'ollama-model-row',
    'ollama-load',
    'ollama-unload',
    'ollama-delete',
    'ollama-copy-name',
    'ollama-copy',
    'ollama-rename-name',
    'ollama-rename',
  ]
  return {
    language: 'english',
    themeDark: true,
    innerWidth: CaptureWidth,
    innerHeight: CaptureHeight,
    devicePixelRatio: 1,
    managerBusy: 'false',
    endpointStatus: 'Connected',
    metrics: 'Version 0.12.6 Installed 3 Running 1',
    metricValues: { Version: '0.12.6', Installed: '3', Running: '1' },
    count: 'Showing 3 of 3 models',
    models: [...BaseModels],
    selected: ['material-chat:7b'],
    running: ['material-chat:7b'],
    detailsText: 'material-chat:7b 7B Q4_K_M completion tools',
    managerContained: true,
    preferencesContained: true,
    documentOverflow: false,
    bodyOverflow: false,
    managerOverflow: false,
    controls: verification.map(value => ({
      verification: value,
      name: value,
    })),
    controlsContained: true,
    controlsNamed: true,
    overlaps: [],
    managerLabelled: true,
    detailsLabelled: true,
    filterLabelled: true,
    scopeLabelled: true,
    missingVerifications: [],
    noticeAbsent: true,
    progressAbsent: true,
    confirmationAbsent: true,
    activeFiniteAnimations: 0,
    privacySafe: true,
  }
}

describe('Ollama manager attach-only verifier contract', () => {
  it('requires one value for every reviewed argument', () => {
    const values = parseArgumentPairs([
      '--port',
      '9337',
      '--p0-run-root',
      'p0',
      '--ollama-run-root',
      'ollama',
      '--capture',
      'capture.png',
      '--receipt',
      'receipt.json',
    ])
    assert.equal(values.get('port'), '9337')
    assert.throws(
      () => parseArgumentPairs(['--port', '9337']),
      /--p0-run-root is required/
    )
    assert.throws(
      () =>
        parseArgumentPairs([
          '--port',
          '9337',
          '--port',
          '9338',
          '--p0-run-root',
          'p0',
          '--ollama-run-root',
          'ollama',
          '--capture',
          'capture.png',
          '--receipt',
          'receipt.json',
        ]),
      /only once/
    )
    assert.throws(
      () =>
        parseArgumentPairs([
          '--port',
          '9337',
          '--p0-run-root',
          'p0',
          '--ollama-run-root',
          'ollama',
          '--capture',
          'capture.png',
          '--receipt',
          'receipt.json',
          '--launch',
          'electron',
        ]),
      /Unknown argument/
    )
  })

  it('accepts only deterministic owned fixtures and owned fresh outputs', () => {
    withOwnedFixtures(({ p0Root, ollamaRoot }) => {
      const p0 = readOwnedP0Fixture(p0Root)
      const ollama = readOwnedOllamaFixture(ollamaRoot)
      assert.equal(p0.accountLogin, 'material-verifier-p0')
      assert.equal(ollama.endpoint, 'http://127.0.0.1:41232')
      const capture = path.join(p0Root, 'captures', 'manager-contract.png')
      assert.equal(validateOwnedOutput(capture, p0, '.png', 'capture'), capture)
      assert.throws(
        () =>
          validateOwnedOutput(
            path.join(p0Root, 'manager-contract.png'),
            p0,
            '.png',
            'capture'
          ),
        /owned P0 captures directory/
      )
      const options = parseArguments([
        '--port',
        '9337',
        '--p0-run-root',
        p0Root,
        '--ollama-run-root',
        ollamaRoot,
        '--capture',
        capture,
        '--receipt',
        path.join(p0Root, 'captures', 'manager-contract.json'),
      ])
      assert.equal(options.port, 9337)
      assert.equal(options.capturePath, capture)
    })
  })

  it('fails closed for non-loopback endpoints and CDP targets', () => {
    assert.equal(
      parseLoopbackURL('http://127.0.0.1:11434', '', 'Ollama').origin,
      'http://127.0.0.1:11434'
    )
    assert.throws(
      () => parseLoopbackURL('https://example.com', '', 'Ollama'),
      /uncredentialed loopback/
    )
    const target = {
      type: 'page',
      url: 'file:///C:/synthetic/out/index.html',
      webSocketDebuggerUrl: 'ws://127.0.0.1:9337/devtools/page/material',
    }
    assert.equal(validateCDPTarget(target, 9337), target)
    assert.throws(
      () =>
        validateCDPTarget(
          {
            ...target,
            webSocketDebuggerUrl:
              'ws://example.com:9337/devtools/page/material',
          },
          9337
        ),
      /loopback attach-only/
    )
    assert.throws(
      () =>
        validateCDPTarget(
          {
            ...target,
            webSocketDebuggerUrl: 'ws://127.0.0.1:9338/devtools/page/material',
          },
          9337
        ),
      /loopback attach-only/
    )
  })

  it('pins the full lifecycle, stable hooks, and provider sync identity', () => {
    const source = fs.readFileSync(
      path.join(__dirname, 'verify_ollama_manager_cdp.js'),
      'utf8'
    )
    for (const hook of [
      'ollama-manager',
      'ollama-endpoint-status',
      'ollama-filter',
      'ollama-scope',
      'ollama-pull-progress',
      'ollama-pull-cancel',
      'ollama-copy',
      'ollama-rename',
      'ollama-load',
      'ollama-unload',
      'ollama-delete-dialog',
      'ollama-delete-confirm',
    ]) {
      assert.match(source, new RegExp(hook))
      assert.match(FinalSurfaceExpression, /data-verification/)
    }
    for (const operation of [
      'pull-start',
      'pull-cancelled',
      'pull-complete',
      'copy',
      'delete',
      'load',
      'unload',
    ]) {
      assert.match(source, new RegExp(operation))
    }
    assert.doesNotMatch(source, /require\(['"]child_process['"]\)/)
    assert.doesNotMatch(source, /show_headless_desktop|create_headless_desktop/)
    assert.doesNotMatch(source, /electron\.exe|taskkill|Stop-Process/)
    assert.match(
      source,
      /ipcRenderer\.emit\('menu-event', \{\}, 'show-preferences'\)/
    )
    assert.doesNotMatch(source, /ipcRenderer\.emit\('show-preferences'\)/)
    assert.match(
      source,
      /querySelector\('#preferences-tab-copilot'\)[\s\S]*?closest\('button\[role="tab"\]'\)[\s\S]*?aria-selected/
    )
    assert.match(source, /'zoom-factor': '1'/)
    assert.match(source, /'zoom-auto-fit-enabled': '0'/)
    assert.doesNotThrow(
      () => new Function(`return (${FinalSurfaceExpression})`)
    )
    assert.match(
      providerModelsExpression(BaseModels, 'http://127.0.0.1:11434'),
      new RegExp(ProviderId)
    )
    assert.match(
      providerModelsExpression(BaseModels, 'http://127.0.0.1:11434'),
      new RegExp(ProviderName)
    )
  })

  it('requires canonical inventory state and the exact mutation audit', () => {
    const canonical = {
      fixture: 'desktop-material-ollama',
      installedModels: [...BaseModels],
      runningModels: ['material-chat:7b'],
      activePulls: [],
      faultMode: 'none',
    }
    assert.doesNotThrow(() =>
      assertCanonicalFixtureState(canonical, 'contract')
    )
    assert.throws(
      () =>
        assertCanonicalFixtureState(
          { ...canonical, installedModels: [...BaseModels, 'unexpected'] },
          'contract'
        ),
      /was not canonical/
    )
    const operations = [
      'pull-start',
      'pull-cancelled',
      'pull-start',
      'pull-complete',
      'copy',
      'copy',
      'delete',
      'load',
      'unload',
      'delete',
    ]
    const events = operations.map((operation, index) => ({
      sequence: index + 11,
      kind: 'mutation',
      operation,
    }))
    const receipt = assertAudit(events, 10)
    assert.equal(receipt.operationCounts['pull-start'], 2)
    assert.throws(
      () =>
        assertAudit(
          events.filter(event => event.operation !== 'unload'),
          10
        ),
      /missing unload/
    )
  })

  it('rejects clipped, inaccessible, or private final surfaces', () => {
    assert.doesNotThrow(() => assertFinalSurface(validSurface()))
    assert.doesNotThrow(() =>
      assertFinalSurface({ ...validSurface(), devicePixelRatio: 1.00000003 })
    )
    assert.throws(
      () => assertFinalSurface({ ...validSurface(), devicePixelRatio: 1.01 }),
      /failed its gate/
    )
    assert.throws(
      () => assertFinalSurface({ ...validSurface(), privacySafe: false }),
      /failed its gate/
    )
    assert.throws(
      () => assertFinalSurface({ ...validSurface(), overlaps: [['a', 'b']] }),
      /failed its gate/
    )
    assert.throws(
      () => assertFinalSurface({ ...validSurface(), filterLabelled: false }),
      /failed its gate/
    )
  })

  it('decodes varied PNG pixels and rejects blank evidence', () => {
    const varied = makeRgbPng(16, 16, (x, y) => [
      x * 16,
      y * 16,
      (x * 17 + y * 31) % 256,
    ])
    const stats = inspectPngBytes(varied, 16, 16)
    assert.equal(stats.width, 16)
    assert.ok(stats.quantizedColorCount >= 32)
    const blank = makeRgbPng(16, 16, () => [0, 0, 0])
    assert.throws(() => inspectPngBytes(blank, 16, 16), /blank or monochrome/)
    assert.throws(() => inspectPngBytes(varied, 17, 16), /PNG contract failed/)
  })
})
