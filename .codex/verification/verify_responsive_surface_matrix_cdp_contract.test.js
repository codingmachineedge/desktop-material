/* eslint-disable no-sync -- contract fixtures use bounded local source reads */

const assert = require('node:assert/strict')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const test = require('node:test')

const driverPath = path.join(
  __dirname,
  'verify_responsive_surface_matrix_cdp.js'
)
const source = fs.readFileSync(driverPath, 'utf8')
const catalog = require('./responsive_surface_catalog.json')
const verifier = require('./verify_responsive_surface_matrix_cdp')

function metadata() {
  return new Map([
    [
      'contract.surface',
      {
        kind: 'surface',
        parentId: 'contract',
        source: 'contract',
        risk: 'safe',
        expected: 'The contract surface remains reachable.',
        conditional: false,
      },
    ],
  ])
}

function appearance(theme = 'dark', languageMode = 'bilingual') {
  const requested = { theme, languageMode }
  return verifier.appearanceReceipt(
    requested,
    verifier.matchingObservedAppearance(requested),
    verifier.matchingAppearanceUIReceipt(requested)
  )
}

function passRow(receipt) {
  return {
    id: 'contract.surface',
    status: 'pass',
    appearance: receipt,
    attempts: [],
    evidence: catalog.viewportMatrix.map(scenario => ({
      scenario,
      appearance: receipt,
      metrics: {},
      receipt: {},
    })),
    capture: {
      path: 'captures/contract.surface.png',
      sha256: '0'.repeat(64),
    },
  }
}

function providerReady(overrides = {}) {
  const endpoint = overrides.endpoint ?? 'http://localhost:49152/api/v3'
  return {
    bind: '127.0.0.1',
    endpoint,
    accountLogin: 'material-verifier-p0',
    accountId: 7_130_701,
    owner: 'material-fixture-owner',
    repository: 'material-fixture',
    credentialService: `GitHub Desktop Dev - ${endpoint}`,
    workflowRunId: 84_101,
    workflowRunCount: 53,
    token: 'contract-secret-must-not-enter-receipts',
    ...overrides,
  }
}

test('appearance options default to light English and accept the audit matrix', () => {
  assert.deepEqual(verifier.parseAppearanceOptions(), {
    theme: 'light',
    languageMode: 'english',
  })
  for (const theme of ['light', 'dark']) {
    for (const languageMode of ['english', 'cantonese', 'bilingual']) {
      assert.deepEqual(verifier.parseAppearanceOptions(theme, languageMode), {
        theme,
        languageMode,
      })
    }
  }
  assert.throws(
    () => verifier.parseAppearanceOptions('system', 'english'),
    /theme must be light or dark/
  )
  assert.throws(
    () => verifier.parseAppearanceOptions('light', 'pirate'),
    /language-mode must be english, cantonese, or bilingual/
  )
})

test('the CLI persists requested appearance before the first audited surface', () => {
  for (const contract of [
    "'theme'",
    "'language-mode'",
    'theme: requested.theme',
    "'language-mode-v1': requested.languageMode",
    'localStorage.setItem(key, value)',
    "document.body.getAttribute('data-dm-language-mode')",
    "document.documentElement.getAttribute('data-language-mode')",
  ]) {
    assert.ok(
      source.includes(contract),
      `missing appearance contract: ${contract}`
    )
  }

  const mainStart = source.indexOf('async function main()')
  const prepare = source.indexOf(
    'await prepareAppearance(page, options)',
    mainStart
  )
  const firstAudit = source.indexOf(
    'await auditBatchCloneRecoveryPopup(page, session, options, ledger)',
    mainStart
  )
  assert.ok(prepare > mainStart && prepare < firstAudit)
})

test('settle fails closed until every bundled font face is ready', () => {
  for (const contract of [
    'document.fonts.ready',
    'document.fonts.load(spec.css, spec.sample)',
    'document.fonts.check(',
    "family: 'Roboto'",
    "family: 'Roboto Mono'",
    "family: 'Roboto Serif'",
    "style: 'italic'",
    "family: 'Material Symbols Rounded'",
    "primaryBodyFamily === 'Roboto'",
  ]) {
    assert.ok(source.includes(contract), `missing font contract: ${contract}`)
  }

  const settleStart = source.indexOf('async function settle(page')
  const settleEnd = source.indexOf('async function emitMenuEvent', settleStart)
  const settleSource = source.slice(settleStart, settleEnd)
  assert.ok(settleSource.includes('await assertBundledFontsLoaded(page)'))
  assert.doesNotMatch(settleSource, /assertBundledFontsLoaded\(page\)\.catch/)
  assert.doesNotMatch(source, /document\.fonts\.ready\.catch/)
})

test('provider readiness exposes only bounded loopback identity fields', () => {
  const identity = verifier.validateProviderIdentity(providerReady())
  assert.deepEqual(identity, {
    endpoint: 'http://localhost:49152/api/v3',
    accountLogin: 'material-verifier-p0',
    accountId: 7_130_701,
    owner: 'material-fixture-owner',
    repository: 'material-fixture',
    workflowRunId: 84_101,
    workflowRunCount: 53,
  })
  assert.equal('token' in identity, false)
  assert.equal('credentialService' in identity, false)
  assert.doesNotMatch(JSON.stringify(identity), /contract-secret/)

  assert.throws(
    () =>
      verifier.validateProviderIdentity(
        providerReady({ endpoint: 'https://github.example/api/v3' })
      ),
    /exact loopback HTTP endpoint/
  )
  assert.throws(
    () =>
      verifier.validateProviderIdentity(
        providerReady({ endpoint: 'http://localhost.example:49152/api/v3' })
      ),
    /exact loopback HTTP endpoint/
  )
})

test('provider readiness fails closed when missing or resolving outside the run', () => {
  const missingRoot = path.join(
    os.tmpdir(),
    `desktop-material-p0-ui-contract-missing-${process.pid}`
  )
  assert.throws(
    () => verifier.readProviderIdentity(missingRoot),
    /readiness file is missing/
  )

  const ownedRoot = path.join(
    os.tmpdir(),
    'desktop-material-p0-ui-contract-owned'
  )
  const escapedProvider = path.join(
    os.tmpdir(),
    'desktop-material-p0-ui-contract-outside',
    'provider'
  )
  assert.throws(
    () =>
      verifier.assertProviderReadinessLocation(
        ownedRoot,
        escapedProvider,
        path.join(escapedProvider, 'ready.json')
      ),
    /outside the owned provider directory/
  )
  assert.doesNotMatch(source, /ready\.token|providerIdentity\.token/)
})

test('provider fixture routing is direct and the audit mutation delta is zero', () => {
  assert.deepEqual(verifier.providerMutationReceipt(7, 7), {
    baseline: 7,
    final: 7,
    delta: 0,
  })
  assert.throws(
    () => verifier.providerMutationReceipt(7, 8),
    /issued a provider mutation request/
  )
  assert.throws(
    () => verifier.providerMutationReceipt(8, 7),
    /mutation receipt is invalid/
  )

  for (const contract of [
    'ensureDirectFixtureProviderRemote(',
    "remote', 'set-url', 'origin', directURL",
    "config', '--unset-all', 'http.proxy'",
    'countProviderMutationRequests(options.runRoot)',
    'options.providerMutationBaseline',
    'providerRemote: options.providerRemoteReceipt',
    'providerMutations: options.providerMutationReceipt',
  ]) {
    assert.ok(
      source.includes(contract),
      `missing provider safety contract: ${contract}`
    )
  }

  const mainStart = source.indexOf('async function main()')
  const normalizeRemote = source.indexOf(
    'options.providerRemoteReceipt = ensureDirectFixtureProviderRemote(',
    mainStart
  )
  const baseline = source.indexOf(
    'options.providerMutationBaseline = countProviderMutationRequests(',
    mainStart
  )
  const connect = source.indexOf('const browser = await connect(', mainStart)
  assert.ok(
    normalizeRemote > mainStart &&
      normalizeRemote < baseline &&
      baseline < connect,
    'Provider safety gates must run before renderer hydration.'
  )
})

test('the four v2 routes are required, selector-owned catalog surfaces', () => {
  const expected = new Map([
    [
      'repository.account-switcher',
      {
        parentId: 'repository',
        ownerSelector: '#repository',
        selector: '.account-switcher',
      },
    ],
    [
      'repository.actions.workflow-manager',
      {
        parentId: 'repository.Actions',
        ownerSelector: '.actions-view',
        selector: '.actions-workflow-management',
      },
    ],
    [
      'repository.actions.workflow-catalog',
      {
        parentId: 'repository.actions.workflow-manager',
        ownerSelector: '.actions-view',
        selector: '.workflow-catalog-dialog',
      },
    ],
    [
      'repository.actions.workflow-dispatch',
      {
        parentId: 'repository.Actions',
        ownerSelector: '.actions-view',
        selector: '.workflow-dispatch-dialog',
      },
    ],
  ])

  for (const [id, fields] of expected) {
    const surface = catalog.nestedSurfaces.find(item => item.id === id)
    assert.notEqual(surface, undefined, `missing ${id}`)
    assert.equal(surface.conditional, undefined, `${id} must be required`)
    assert.equal(surface.parentId, fields.parentId)
    assert.equal(surface.ownerSelector, fields.ownerSelector)
    assert.equal(surface.selector, fields.selector)
    assert.match(surface.source, /\.tsx#[A-Z][A-Za-z]+$/)
  }

  const metadata = verifier.buildCatalogMetadata()
  assert.equal(metadata.size, 85)
  for (const id of expected.keys()) {
    assert.equal(metadata.get(id)?.conditional, false)
  }
})

test('the four v2 routes use deterministic fixture gates and reversible teardown', () => {
  for (const contract of [
    "requiredNestedRoute('repository.account-switcher')",
    "'repository.actions.workflow-manager'",
    "'repository.actions.workflow-catalog'",
    "'repository.actions.workflow-dispatch'",
    "name: 'Switch account'",
    "locator('.account-switcher-row')",
    "name: 'Add another account'",
    "name: 'Manage workflows'",
    "locator('.actions-workflow-row')",
    "name: 'New workflow'",
    "locator('.workflow-template-card')",
    "name: 'Run workflow'",
    "locator('.actions-loading')",
    "locator('.workflow-dispatch-run-button:not([disabled])')",
    "name: 'Close new workflow dialog'",
    "name: 'Close run workflow dialog'",
    "getAttribute('aria-expanded')",
    'persistedProviderUsers(options.providerIdentity)',
    "token: ''",
    'appStore.accountsStore.reloadFromStore()',
    'appStore.accountsStore.refresh()',
    'appStore.repositoryWithRefreshedGitHubRepository(selectedBefore)',
    'actionsStore.subscribe(',
    'actionsStore.refresh(actionsRepository, true)',
    'base.credentialTokenPresent',
    'receipt?.runsTotalCount !== identity.workflowRunCount',
    'provider: options.providerReceipt',
    'locator(\'select[name="languageMode"]\')',
    "visibleTab(dialog, 'Global ignore')",
    "locator('#global-ignore-path')",
    "input.getAttribute('aria-label') === primaryAccessibleName",
    'options.appearanceUIReceipt = receipt',
  ]) {
    assert.ok(source.includes(contract), `missing route contract: ${contract}`)
  }

  const mainStart = source.indexOf('async function main()')
  const prepareRepository = source.indexOf(
    'await prepareApp(page, options.repositoryPath)',
    mainStart
  )
  const account = source.indexOf(
    'await auditAccountSwitcher(page, session, options, ledger)',
    mainStart
  )
  const hydrate = source.indexOf(
    'await hydrateProviderFixture(page, options)',
    mainStart
  )
  const appearanceUI = source.indexOf(
    'await auditAppearancePreferenceUI(page, options)',
    mainStart
  )
  const repositorySections = source.indexOf(
    'await auditRepositorySections(page, session, options, ledger)',
    mainStart
  )
  assert.ok(
    prepareRepository < hydrate &&
      hydrate < appearanceUI &&
      appearanceUI < account &&
      account < repositorySections,
    'Fresh-profile provider and persisted Appearance UI hydration must complete before account and Actions traversal.'
  )
  assert.match(
    source,
    /if \(surface\.member === 'Actions'\) \{\s*await auditActionsDesignSurfaces\(page, session, options, ledger\)/
  )

  assert.doesNotMatch(
    source,
    /locator\('\.actions-workflow-switch'\)[\s\S]{0,120}\.click\(/
  )
  assert.doesNotMatch(
    source,
    /locator\('\.workflow-template-use'\)[\s\S]{0,120}\.click\(/
  )
  assert.doesNotMatch(
    source,
    /locator\('\.workflow-dispatch-run-button:not\(\[disabled\]\)'\)[\s\S]{0,120}\.click\(/
  )
})

test('pass receipts fail closed when observed theme or language drifts', () => {
  const receipt = appearance()
  verifier.assertAppearanceState(
    receipt.requested,
    receipt.observed,
    'matching receipt'
  )

  const wrongTheme = structuredClone(receipt)
  wrongTheme.observed.theme = 'light'
  assert.throws(
    () =>
      verifier.assertAppearanceState(
        wrongTheme.requested,
        wrongTheme.observed,
        'wrong theme'
      ),
    /requested theme\/language were not observed/
  )

  const wrongLanguage = structuredClone(receipt)
  wrongLanguage.observed.languageMode = 'english'
  assert.throws(
    () =>
      verifier.assertAppearanceState(
        wrongLanguage.requested,
        wrongLanguage.observed,
        'wrong language'
      ),
    /requested theme\/language were not observed/
  )

  const wrongSelect = structuredClone(receipt)
  wrongSelect.ui.selectValue = 'english'
  assert.throws(
    () =>
      verifier.validateAppearanceReceipt(
        wrongSelect,
        'wrong persisted select',
        true
      ),
    /persisted Appearance UI did not match bilingual/
  )

  const missingCantonese = structuredClone(receipt)
  missingCantonese.ui.visibleCantonesePresent = false
  assert.throws(
    () =>
      verifier.validateAppearanceReceipt(
        missingCantonese,
        'missing localized copy',
        true
      ),
    /persisted Appearance UI did not match bilingual/
  )

  const inaccessibleBilingual = structuredClone(receipt)
  inaccessibleBilingual.ui.primaryAccessibleNameMatched = false
  assert.throws(
    () =>
      verifier.validateAppearanceReceipt(
        inaccessibleBilingual,
        'wrong primary accessible name',
        true
      ),
    /persisted Appearance UI did not match bilingual/
  )
})

test('every summary and viewport evidence row carries a matching receipt', () => {
  const receipt = appearance('dark', 'cantonese')
  const ledger = verifier.decorateLedger(
    [passRow(receipt)],
    metadata(),
    receipt
  )
  verifier.validateLedger(ledger)
  assert.deepEqual(ledger[0].appearance, receipt)
  assert.equal(ledger[0].evidence.length, catalog.viewportMatrix.length)
  assert.ok(
    ledger[0].evidence.every(row => row.appearance === receipt),
    'each viewport row must retain the requested and observed values'
  )

  const beforeUIPreflight = verifier.appearanceReceipt(
    receipt.requested,
    receipt.observed
  )
  const merged = verifier.decorateLedger(
    [passRow(beforeUIPreflight)],
    metadata(),
    receipt
  )
  verifier.validateLedger(merged)
  assert.deepEqual(merged[0].appearance.ui, receipt.ui)
  assert.ok(
    merged[0].evidence.every(row =>
      Object.keys(receipt.ui).every(
        field => row.appearance.ui[field] === receipt.ui[field]
      )
    ),
    'early evidence inherits the single persisted UI preflight receipt'
  )

  const missingEvidenceReceipt = structuredClone(ledger)
  delete missingEvidenceReceipt[0].evidence[0].appearance
  assert.throws(
    () => verifier.validateLedger(missingEvidenceReceipt),
    /Invalid appearance receipt for responsive evidence/
  )

  const mismatchedSummary = structuredClone(ledger)
  mismatchedSummary[0].appearance.observed.persistedLanguageMode = 'english'
  assert.throws(
    () => verifier.validateLedger(mismatchedSummary),
    /requested theme\/language were not observed/
  )

  const mismatchedUI = structuredClone(ledger)
  mismatchedUI[0].evidence[0].appearance.ui.selectValue = 'english'
  assert.throws(
    () => verifier.validateLedger(mismatchedUI),
    /persisted Appearance UI did not match cantonese/
  )
})
