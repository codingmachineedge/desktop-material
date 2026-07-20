'use strict'

const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const test = require('node:test')
const vm = require('node:vm')

const driverPath = path.join(__dirname, 'capture_gallery_cdp.js')
const source = fs.readFileSync(driverPath, 'utf8')

function frozenStringArray(name) {
  const match = source.match(
    new RegExp(`const ${name} = Object\\.freeze\\(\\[([\\s\\S]*?)\\]\\)`)
  )
  assert.notEqual(match, null, `${name} is missing`)
  return [...match[1].matchAll(/'([^']+)'/g)].map(([, value]) => value)
}

function sceneSource(name) {
  const start = source.indexOf(`scene('${name}'`)
  assert.notEqual(start, -1, `${name} scene is missing`)
  const next = source.indexOf("\nscene('", start + 1)
  return source.slice(start, next === -1 ? source.length : next)
}

test('every requested scene resets before its runner executes', () => {
  const loopStart = source.indexOf('for (const name of names)')
  const loopEnd = source.indexOf('client.close()', loopStart)
  assert.notEqual(loopStart, -1)
  assert.notEqual(loopEnd, -1)

  const sceneLoop = source.slice(loopStart, loopEnd)
  const resetIndex = sceneLoop.indexOf('await resetSceneState(name)')
  const runIndex = sceneLoop.indexOf('await run()')
  assert.notEqual(resetIndex, -1)
  assert.notEqual(runIndex, -1)
  assert.ok(resetIndex < runIndex)
})

test('reset covers every transient surface that contaminated captures', () => {
  for (const contract of [
    "'dialog[open]'",
    '\'[role="dialog"]\'',
    "'#foldout-container'",
    "'#app-menu-foldout'",
    "'.material-context-menu-backdrop'",
    "'.error-notice-stack .error-notice'",
    "'.error-notice-dismiss'",
    "'Hide'",
    "'Skip for now'",
    '\'.tooltip, [role="tooltip"]\'',
    "'Input.dispatchMouseEvent'",
    "await menuEvent('zoom-reset')",
    "await menuEvent('show-changes')",
    'await assertNoSceneLeaks(`scene ${name}`)',
  ]) {
    assert.ok(source.includes(contract), `missing reset contract: ${contract}`)
  }
})

test('every capture suppresses unrelated Undo chrome and incidental focus paint', () => {
  const prepareStart = source.indexOf('async function prepareCaptureSurface(')
  const prepareEnd = source.indexOf('\nasync function capture(', prepareStart)
  const captureEnd = source.indexOf('\n/** Emit a menu event', prepareEnd)
  assert.notEqual(prepareStart, -1)
  assert.notEqual(prepareEnd, -1)
  assert.notEqual(captureEnd, -1)

  const prepare = source.slice(prepareStart, prepareEnd)
  const capture = source.slice(prepareEnd, captureEnd)
  for (const contract of [
    "document.querySelector('#undo-commit')",
    "style.setProperty('display', 'none', 'important')",
    "setAttribute('data-capture-suppressed', 'true')",
    'focused.blur()',
    'requestAnimationFrame(() =>',
    'receipt?.undoHidden !== true',
    'retained unrelated Undo commit chrome',
  ]) {
    assert.ok(prepare.includes(contract), `capture hygiene misses ${contract}`)
  }
  assert.ok(
    prepare.match(/requestAnimationFrame\(/g)?.length >= 2,
    'capture hygiene must settle for two animation frames'
  )

  const hygiene = capture.indexOf('await prepareCaptureSurface(name)')
  const privacy = capture.indexOf('await assertCapturePrivacy(name)')
  const screenshot = capture.indexOf("client.send('Page.captureScreenshot'")
  assert.ok(hygiene >= 0 && hygiene < privacy && privacy < screenshot)
  for (const dimensionsContract of [
    'const dimensions = pngDimensions(file)',
    'dimensions.width !== currentViewportWidth',
    'dimensions.height !== currentViewportHeight',
  ]) {
    assert.ok(
      capture.includes(dimensionsContract),
      `capture misses dimension gate: ${dimensionsContract}`
    )
  }
})

test('contaminated gallery scenes always restore the Changes base', () => {
  const match = source.match(
    /const StatePreservingScenes = new Set\(\[([\s\S]*?)\]\)/
  )
  assert.notEqual(match, null)
  const statePreservingScenes = match[1]

  for (const scene of [
    'repository-tools',
    'repository-tools-scroll',
    'branch-rules',
    'add-submodule',
    'anchored-appearance',
    'repository-folder-detection',
    'repository-submodule-management',
  ]) {
    assert.ok(
      source.includes(`scene('${scene}'`),
      `gallery scene is missing: ${scene}`
    )
    assert.ok(
      !statePreservingScenes.includes(`'${scene}'`),
      `gallery scene may bypass the Changes reset: ${scene}`
    )
  }
})

test('appearance captures open the actual owners instead of retired settings tabs', () => {
  for (const contract of [
    "scene('anchored-appearance'",
    "contextMenuSelector('#desktop-app-toolbar')",
    "scene('logo-studio'",
    "contextMenuSelector('.repository-list-logo-appearance-target')",
    "scene('tab-style'",
    "contextMenuSelector('.repository-tab.active .repository-tab-label')",
    'waitForPrivacySafeAnchoredEditor',
  ]) {
    assert.ok(source.includes(contract), `missing owner contract: ${contract}`)
  }

  assert.ok(!source.includes("captureSettingsTab('Appearance'"))
  assert.ok(!source.includes("openRepositorySettingsTab('Appearance')"))
  assert.ok(!source.includes("scene('settings-appearance'"))
})

test('app identity capture proves a reload-restored closed workspace', () => {
  const identity = sceneSource('app-identity')
  for (const contract of [
    'const GalleryAppIdentity = Object.freeze({',
    "displayName: 'Material Studio'",
    "logo: 'sparkle'",
  ]) {
    assert.ok(
      source.includes(contract),
      `app identity state misses ${contract}`
    )
  }

  for (const contract of [
    'repositoryTabsStore.getActiveTab()',
    'dispatcher.setAppearanceCustomization({',
    'repositoryTabsStore.setTabFavorite(activeTab.id, true)',
    "'live customized app identity and favorite repository tab'",
    "crypto.randomBytes(12).toString('hex')",
    "crypto.randomBytes(32).toString('hex')",
    '`desktop-material:gallery:app-identity:${reloadProofId}`',
    '`__desktopMaterialGalleryReload_${reloadProofId}`',
    'sessionStorage.setItem(storageKey, nonce)',
    'Object.defineProperty(window, sentinelKey, {',
    'sentinelPresent:',
    "await evaluate('window.location.reload(), true')",
    "resetSceneState('restored app-identity workspace')",
    "'stable restored app-identity workspace'",
    '.getAnimations({ subtree: true })',
    'activeFiniteAnimations.length === 0',
    'requestAnimationFrame(() => requestAnimationFrame(',
    '\'.repository-tab.active.favorite[role="tab"][aria-selected="true"]\'',
    "document.querySelector('.app-identity-section') === null",
    "document.querySelector('.anchored-appearance-editor') === null",
    "document.querySelector('#preferences') === null",
    'sessionNonceMatches:',
    'sessionStorage.getItem(',
    'globalSentinelAbsent: !Object.prototype.hasOwnProperty.call(',
    'restored?.sessionNonceMatches !== true',
    'restored?.globalSentinelAbsent !== true',
    'restored?.timeOrigin > beforeReloadTimeOrigin',
    "assertNoSceneLeaks('restored app-identity workspace')",
    'APP_IDENTITY_RELOAD',
    'sessionNonceSurvived:',
    'navigationType: restored.navigationType',
    'appIdentity: originalIdentity',
    'sessionStorage.removeItem(',
    'reloadProofRemoved:',
    'identityRestored:',
    'tabFound:',
    'favoriteRestored:',
  ]) {
    assert.ok(
      identity.includes(contract),
      `app identity gate misses ${contract}`
    )
  }

  assert.ok(!identity.includes('contextMenuSelector('))
  assert.ok(!identity.includes('waitForPrivacySafeAnchoredEditor('))
  assert.ok(!identity.includes("restored?.navigationType !== 'reload'"))
  const armProof = identity.indexOf('sessionStorage.setItem(storageKey, nonce)')
  const reload = identity.indexOf(
    "await evaluate('window.location.reload(), true')"
  )
  const persistenceGate = identity.indexOf(
    'Restored app identity workspace failed its persistence/geometry gate'
  )
  const capture = identity.indexOf("capture('material-app-identity-workspace')")
  const cleanup = identity.indexOf('appIdentity: originalIdentity')
  const removeProof = identity.indexOf('sessionStorage.removeItem(', capture)
  assert.ok(armProof >= 0 && armProof < reload)
  assert.ok(reload < persistenceGate)
  assert.ok(persistenceGate >= 0 && persistenceGate < capture)
  assert.ok(capture < cleanup)
  assert.ok(cleanup < removeProof)
})

test('settings captures select distinct settled Preferences tabs', () => {
  const settings = sceneSource('settings')
  const accounts = sceneSource('settings-accounts')
  const helperStart = source.indexOf('async function captureSettingsTab(')
  const helperEnd = source.indexOf(
    "\nscene('settings-agent-access'",
    helperStart
  )
  assert.notEqual(helperStart, -1)
  assert.notEqual(helperEnd, -1)
  const helper = source.slice(helperStart, helperEnd)

  assert.ok(settings.includes("captureSettingsTab('Git', 'material-settings')"))
  assert.ok(
    accounts.includes(
      "captureSettingsTab('Accounts', 'material-provider-accounts')"
    )
  )

  for (const contract of [
    'preferences-tab-${tabLabel',
    'label?.closest(\'button[role="tab"]\')',
    "tab.classList.contains('selected')",
    "tab.getAttribute('aria-selected') === 'true'",
    "panel.getAttribute('aria-labelledby')",
    'bounds.width > 0 && bounds.height > 0',
    '.getAnimations({ subtree: true })',
    'iterations !== Infinity',
    'activeFiniteAnimations.length === 0',
    'selected ${tabLabel} settings tab',
    'stable selected ${tabLabel} settings tab',
    'requestAnimationFrame(() => requestAnimationFrame(',
  ]) {
    assert.ok(helper.includes(contract), `settings tab gate misses ${contract}`)
  }
  assert.ok(!helper.includes('await sleep(700)'))
  assert.ok(!helper.includes('await sleep(900)'))
  assert.ok(
    helper.indexOf('stable selected ${tabLabel} settings tab') <
      helper.indexOf('await capture(name)'),
    'the exact stable tab gate must pass before capture'
  )
})

test('appearance captures require a visible in-viewport owner editor', () => {
  for (const contract of [
    "editor?.closest('.popover-component')",
    'bounds.width > 0',
    'bounds.left >= -0.5',
    'bounds.right <= window.innerWidth + 0.5',
    'repository toolbar appearance title',
  ]) {
    assert.ok(source.includes(contract), `missing appearance gate: ${contract}`)
  }
  const scene = sceneSource('anchored-appearance')
  assert.ok(
    scene.indexOf('repository toolbar appearance title') <
      scene.indexOf("capture('material-customization')"),
    'the toolbar editor must be visible before capture'
  )
})

test('repository logo capture proves its foldout portal and scroll range', () => {
  const logo = sceneSource('logo-studio')
  for (const contract of [
    "document.querySelector('.repository-logo-anchored-editor')",
    "editor.closest('.foldout') === null",
    'mount.parentElement === foldoutContainer',
    'popoverBounds.width > foldoutBounds.width',
    'content.clientHeight >= Math.min(320, window.innerHeight - 200)',
    "studio?.querySelector('.repository-logo-editor-scroll')",
    "headingText.data !== 'Custom repository logo'",
    'firstGlyphRange.setEnd(headingText, 1)',
    "contentStyle.overflowY === 'auto'",
    "workbenchScrollStyle.overflowY === 'visible'",
    'contentOwnsScroll && !workbenchOwnsScroll',
    'content.scrollLeft === 0 && workbenchScroll.scrollLeft === 0',
    'firstGlyphBounds.left >= studioBounds.left + 4',
    "studio?.querySelector('#repository-logo-studio-heading')",
    'studio?.querySelector(\'[aria-label^="Live logo preview for "]\')',
    'studio?.querySelector(\'[aria-label="Logo presets"]\')',
    'content.scrollHeight - content.clientHeight',
    'content.scrollTop = content.scrollHeight',
    'reachedBottom',
    'content.scrollTop = 0',
    'restored repository logo studio scroll position',
  ]) {
    assert.ok(
      logo.includes(contract),
      `repository logo gate misses ${contract}`
    )
  }
  assert.ok(
    logo.indexOf('restored repository logo studio scroll position') <
      logo.indexOf("capture('material-repository-logo-studio')"),
    'the portal and scroll gates must run before capture'
  )
})

test('regex builder capture proves the first sample hash is fully visible', () => {
  const regex = sceneSource('regex-builder')
  for (const contract of [
    "document.querySelector('.regex-test-sample')",
    "document.querySelector('.regex-test-preview')",
    'sample.scrollTop = 0',
    'preview.scrollTop = 0',
    '/[0-9a-f]{40}.*[0-9a-f]{7}/i',
    'sample.rows >= hashLineIndex + 1',
    'contentHeight >= lineHeight * (hashLineIndex + 1) - 0.5',
    'hashRange.setStart(previewText, hashOffset)',
    'hashBounds.top >= previewBounds.top - 0.5',
    'hashBounds.bottom <= previewBounds.bottom + 0.5',
    'fully visible first regex sample hash line',
  ]) {
    assert.ok(regex.includes(contract), `regex capture gate misses ${contract}`)
  }
  assert.ok(
    regex.indexOf('fully visible first regex sample hash line') <
      regex.indexOf("capture('regex-builder')"),
    'the sample-row geometry gate must pass before capture'
  )
})

test('provider triage capture waits for the exact settled surface', () => {
  const triage = sceneSource('provider-triage')
  for (const contract of [
    "document.querySelector('#triage-tab')",
    'closest(\'button[role="tab"]\')',
    "getAttribute('aria-selected') === 'true'",
    "document.querySelector('main.provider-triage-view')",
    "querySelectorAll('.provider-triage-channel.ready')",
    "querySelectorAll('.provider-triage-item')",
    "heading?.textContent?.trim() === '2 of 2 work items'",
    'settled exact provider triage surface',
  ]) {
    assert.ok(triage.includes(contract), `provider triage misses ${contract}`)
  }
  assert.ok(
    triage.indexOf('settled exact provider triage surface') <
      triage.indexOf("capture('material-provider-triage')"),
    'the settled triage gate must run before capture'
  )
})

test('issues capture proves a populated list and useful selected detail', () => {
  const issues = sceneSource('issues')
  for (const contract of [
    "captureSection('Issues', null, 3500)",
    "document.querySelectorAll('.github-issue-row')",
    "count?.textContent?.trim() === '1 on page 1'",
    "document.querySelector('.github-issues-busy, .github-issues-metadata-note')",
    "clickSelector('.github-issue-row')",
    "title?.textContent?.trim() === 'Verify the complete Windows gallery before publication'",
    'comments?.length === 1',
    "['Open on GitHub', 'Edit', 'Add comment', 'Close issue']",
    'selected issue detail, lifecycle controls, and comments',
  ]) {
    assert.ok(
      issues.includes(contract),
      `GitHub Issues gate misses ${contract}`
    )
  }
  assert.ok(
    issues.indexOf('selected issue detail, lifecycle controls, and comments') <
      issues.indexOf("capture('material-github-issues')")
  )
})

test('multi-window capture opens the selected repository context menu', () => {
  const multiWindow = sceneSource('multi-window-menu')
  for (const contract of [
    "clickAria('Open a repository in a new tab')",
    '#foldout-container .repository-list [role="option"][aria-selected="true"][data-context-menu-owner="true"]',
    'contextMenuSelector(selectedRepository)',
    'document.querySelector(\'.material-context-menu[role="menu"]\')',
    "querySelector('.context-menu-item-label')",
    "'Open in new window'",
    'enabled Open in new window repository command',
  ]) {
    assert.ok(
      multiWindow.includes(contract),
      `multi-window menu misses ${contract}`
    )
  }
  assert.ok(
    multiWindow.indexOf('enabled Open in new window repository command') <
      multiWindow.indexOf("capture('material-multi-window-menu')"),
    'the exact repository command gate must run before capture'
  )
})

test('submodule context capture waits for its final unanimated surface', () => {
  const submodule = sceneSource('submodule-context')
  for (const contract of [
    "document.querySelector('#submodule-manager') === null",
    "document.querySelector('.changes-interstitial')",
    "heading?.textContent?.trim() === 'No local changes'",
    "document.querySelector('.submodule-repository-context')",
    "document.querySelector('#repository-sidebar')",
    'root.getAnimations({ subtree: true })',
    'iterations !== Infinity',
    'animation.pending',
    "animation.playState === 'running'",
    'activeFiniteAnimations.length === 0',
    'settled temporary submodule Changes surface',
    'requestAnimationFrame(() => requestAnimationFrame(',
  ]) {
    assert.ok(submodule.includes(contract), `submodule gate misses ${contract}`)
  }
  assert.ok(!submodule.includes('await sleep(900)'))
  assert.ok(
    submodule.indexOf('settled temporary submodule Changes surface') <
      submodule.indexOf("capture('material-submodule-context')"),
    'the final surface and animation gates must run before capture'
  )
})

test('merge-all capture preserves main and cleans only its evidence branch', () => {
  const mergeAll = sceneSource('merge-all')
  for (const contract of [
    'assertOwnedDisposableFixture()',
    "'symbolic-ref', 'refs/remotes/origin/HEAD'",
    '`refs/remotes/origin/${ready.defaultBranch}`',
    'startingBranch !== ready.featureBranch',
    'rows.length !== 1',
    "'gallery/merge-all-evidence'",
    "textContent?.trim() === 'up-to-date'",
    "'Already up to date; cleaned up and deleted.'",
    "textContent?.trim() === 'main'",
    "'refs/heads/main'",
    "'refs/heads/gallery/merge-all-evidence'",
    'survivingBranch !== ready.defaultBranch',
    '!mainExists',
    'evidenceExists',
    'single safe Merge All result',
  ]) {
    assert.ok(mergeAll.includes(contract), `merge-all gate misses ${contract}`)
  }
  assert.ok(
    mergeAll.indexOf('single safe Merge All result') <
      mergeAll.indexOf("capture('material-branch-merge-all')"),
    'the exact result gate must run before capture'
  )
  assert.ok(
    mergeAll.indexOf('survivingBranch !== ready.defaultBranch') <
      mergeAll.indexOf("capture('material-branch-merge-all')"),
    'the post-operation Git proof must run before capture'
  )
})

test('new prerequisite scenes use deterministic synthetic owner flows', () => {
  const expected = new Map([
    ['anchored-appearance', 'material-customization'],
    ['repository-folder-detection', 'material-repository-folder-detection'],
    [
      'repository-submodule-management',
      'material-repository-submodule-management',
    ],
  ])

  for (const [sceneName, captureName] of expected) {
    assert.ok(source.includes(`scene('${sceneName}'`))
    assert.ok(source.includes(`capture('${captureName}')`))
  }

  assert.ok(source.includes("['design-system', 'tools/release-kit']"))
  assert.ok(source.includes("channel === 'show-open-dialog'"))
  assert.ok(
    source.includes("setter.call(input, 'C:\\\\Synthetic\\\\Repository Fleet')")
  )
  assert.ok(
    /shiftF10Selector\(\s*'\.submodule-appearance-preview \.submodule-context-back'\s*\)/.test(
      source
    )
  )
})

test('reset rejects unknown base surfaces and residual leakage', () => {
  assert.ok(source.includes('No known base surface is available before'))
  assert.ok(source.includes('did not reset to a known base surface'))
  assert.ok(source.includes('Scene reset left visible UI leakage before'))
})

test('capture-only tooltip suppression is removed before disconnect', () => {
  const cleanup = source.indexOf(
    "document.getElementById('gallery-tooltip-suppressor')?.remove()"
  )
  const close = source.indexOf('client.close()', cleanup)
  assert.notEqual(cleanup, -1)
  assert.notEqual(close, -1)
  assert.ok(cleanup < close)
})

test('canonical mode owns the exact 68-image wiki catalog', () => {
  const scenes = frozenStringArray('CanonicalGalleryScenes')
  const outputs = frozenStringArray('CanonicalGalleryOutputs')
  const gallery = fs.readFileSync(
    path.join(__dirname, '..', '..', 'docs', 'wiki', 'Feature-Gallery.md'),
    'utf8'
  )
  const catalog = [
    ...gallery.matchAll(/^\| `([^`]+)\.png` \| [^|]+ \|$/gm),
  ].map(([, name]) => name)

  assert.equal(outputs.length, 68)
  assert.equal(new Set(outputs).size, 68)
  assert.deepEqual([...outputs].sort(), [...catalog].sort())
  for (const sceneName of scenes) {
    assert.ok(source.includes(`scene('${sceneName}'`), sceneName)
  }
  for (const required of [
    'submodule-context',
    'advanced-workflows',
    'cheap-lfs-preparing',
  ]) {
    assert.ok(scenes.includes(required), required)
  }
  assert.ok(source.includes("process.stdout.write('CANONICAL 68/68"))
})

test('capture candidates cannot overwrite tracked screenshots directly', () => {
  assert.ok(source.includes('requestedOutDir === undefined ? null'))
  assert.ok(
    source.includes(
      "fail('Capture candidates must be reviewed in Temp before promotion.')"
    )
  )
  assert.ok(source.includes("{ flag: 'wx' }"))
  assert.ok(source.includes('const capturedHashes = new Map()'))
  assert.ok(source.includes('duplicates ${duplicate}.png byte-for-byte'))
  assert.ok(!source.includes("args.get('out') ?? 'docs/assets/screenshots'"))
})

test('API app-function capture saves and shows a repository-bound function', () => {
  const apiFunctions = sceneSource('api-app-functions')
  for (const contract of [
    'Filter mode: Substring',
    'repos/get',
    "select')?.value === 'GET'",
    'repos/material-fixture-owner/material-fixture',
    'repository request template',
    'get_repository',
    'Add current request as function',
    '1 for this repository',
    'Named API functions',
    "querySelector('code')?.textContent?.trim()",
    "querySelector('header > span.read')?.textContent?.trim() === 'read'",
    'querySelector(\'[role="alert"]\')?.textContent?.trim()',
    "functions.scrollIntoView({ block: 'center' })",
    "capture('material-api-app-functions')",
  ]) {
    assert.ok(
      apiFunctions.includes(contract),
      `API app-functions scene misses ${contract}`
    )
  }
  for (const forbidden of [
    "clickText('Run function'",
    "clickText('Run request'",
    "clickText('Run reviewed request'",
  ]) {
    assert.ok(
      !apiFunctions.includes(forbidden),
      `API app-functions scene must not invoke ${forbidden}`
    )
  }
  const selection = apiFunctions.indexOf(
    '.github-api-explorer-operation-create[data-operation-id='
  )
  const save = apiFunctions.indexOf('Add current request as function')
  const capture = apiFunctions.indexOf("capture('material-api-app-functions')")
  assert.ok(selection >= 0 && selection < save)
  assert.ok(save < capture)
})

test('every screenshot passes the universal private-path gate', () => {
  const privacy = source.indexOf('async function assertCapturePrivacy(name)')
  const screenshot = source.indexOf("client.send('Page.captureScreenshot'")
  assert.notEqual(privacy, -1)
  assert.notEqual(screenshot, -1)
  assert.ok(privacy < screenshot)
  assert.ok(source.includes('await assertCapturePrivacy(name)'))
  assert.ok(source.includes('.filter(value => !bundledAsset(value))'))
  assert.ok(
    source.includes('out\\/static\\/[a-z0-9._-]+\\.(?:gif|ico|png|svg|webp)')
  )
  for (const marker of [
    'C:\\\\Users\\\\',
    'C:\\/Users\\/',
    'ADMINI~1',
    'AppData',
    'desktop-material-p0-ui-',
    '.repository-tools-introduction',
    '.sparse-checkout-heading-copy small',
    '.tab-search-result-copy > span',
    'C:\\\\Synthetic\\\\material-fixture',
  ]) {
    assert.ok(source.includes(marker), `missing privacy contract: ${marker}`)
  }
})

test('settings history masks only the owned run path before capture', () => {
  const helperStart = source.indexOf(
    'async function maskSettingsHistoryPrivatePaths()'
  )
  const helperEnd = source.indexOf(
    'function countProviderRequests(',
    helperStart
  )
  const helper = source.slice(helperStart, helperEnd)
  const settingsHistory = sceneSource('settings-history')
  assert.ok(helper.includes("const syntheticRoot = 'C:\\\\Synthetic"))
  assert.ok(helper.includes('fs.realpathSync.native(path.resolve(runRoot))'))
  assert.ok(helper.includes("privateRoot.replaceAll('\\\\', '\\\\\\\\')"))
  assert.ok(
    settingsHistory.indexOf('await maskSettingsHistoryPrivatePaths()') <
      settingsHistory.indexOf("await capture('settings-history-manager')")
  )
})

test('fixture mutation is restricted to the named owned Temp run', () => {
  const ownership = source.indexOf('function assertOwnedDisposableFixture()')
  const assertion = source.indexOf(
    'assertOwnedDisposableFixture()',
    ownership + 1
  )
  const loop = source.indexOf('for (const name of names)', assertion)
  assert.notEqual(ownership, -1)
  assert.notEqual(assertion, -1)
  assert.notEqual(loop, -1)
  assert.ok(ownership < assertion && assertion < loop)
  for (const contract of [
    'fs.realpathSync.native(os.tmpdir())',
    "startsWith('desktop-material-p0-ui-')",
    "relativeFixture.toLowerCase() !== 'fixture'",
  ]) {
    assert.ok(
      source.includes(contract),
      `missing ownership contract: ${contract}`
    )
  }
})

test('fixture account hydration returns only privacy-safe receipts', () => {
  const start = source.indexOf('async function seedProfile()')
  const end = source.indexOf('async function ensureRepository(', start)
  const seed = source.slice(start, end)
  const repositoryOpen = seed.indexOf('await ensureRepository(fixturePath)')
  const hydration = seed.indexOf('const hydrated = await evaluate')
  assert.ok(repositoryOpen >= 0, 'seedProfile must open the owned fixture')
  assert.ok(
    repositoryOpen < hydration,
    'seedProfile must open the owned fixture before provider hydration'
  )
  for (const contract of [
    'accountsStore.reloadFromStore()',
    'accountsStore.refresh()',
    'accountsStore.getAll()',
    'repositoryWithRefreshedGitHubRepository(repository)',
    'accountCount: accounts.length',
    'fixtureAccountMatched: fixtureAccount !== undefined',
    'fixtureTokenPresent:',
    'fixtureCopilotFeatureEnabled:',
    'fixtureAccount?.features?.includes(',
    "'desktop_enable_copilot_sdk_commit_message_generation'",
    'repositoryMatched: Boolean(freshRepository?.gitHubRepository)',
    'selectedRepositoryMatched: Boolean(',
  ]) {
    assert.ok(
      seed.includes(contract),
      `missing hydration contract: ${contract}`
    )
  }
  assert.ok(seed.includes("client.send('Page.reload', { ignoreCache: true })"))
  assert.ok(seed.includes('beforeSeedReloadTimeOrigin'))
  assert.ok(!seed.includes('fixtureAccount?.isCopilotDesktopEnabled'))
  assert.ok(!seed.includes('fixtureAccount?.copilotLicenseType'))
  for (const leak of [
    'login: value.login',
    'endpoint: value.endpoint',
    'token: fixtureAccount',
  ]) {
    assert.ok(!seed.includes(leak), `hydration receipt leaks: ${leak}`)
  }
})

test('fixture account hydration removes only its exact temporary Git proxy', () => {
  const start = source.indexOf('function ensureDirectFixtureProviderRemote()')
  const end = source.indexOf('async function seedProfile()', start)
  const remote = source.slice(start, end)
  for (const contract of [
    "['-C', fixturePath, 'config', '--get-all', 'http.proxy']",
    '`http://127.0.0.1:${endpoint.port}`',
    'Fixture proxy is not the owned provider',
    "['-C', fixturePath, 'remote', 'set-url', 'origin', directURL]",
    "['-C', fixturePath, 'config', '--unset-all', 'http.proxy']",
  ]) {
    assert.ok(remote.includes(contract), `missing proxy contract: ${contract}`)
  }
  assert.ok(
    remote.indexOf('proxyValues[0] !== expectedProxy') <
      remote.indexOf("'--unset-all'"),
    'the proxy must be validated before it is removed'
  )
})

test('Ollama evidence uses an owned loopback fixture and a full reversible UI exercise', () => {
  const fixtureStart = source.indexOf('function readOwnedOllamaFixture(')
  const fixtureEnd = source.indexOf(
    'function assertOwnedDisposableFixture()',
    fixtureStart
  )
  assert.ok(fixtureStart >= 0 && fixtureEnd > fixtureStart)
  const fixture = source.slice(fixtureStart, fixtureEnd)
  for (const contract of [
    "args.get('ollama-run-root')",
    'fs.realpathSync.native(os.tmpdir())',
    '/^desktop-material-ollama-',
    "receipt.fixture !== 'desktop-material-ollama'",
    'receipt.protocolVersion !== 1',
    "receipt.bind !== '127.0.0.1'",
    "endpoint.protocol !== 'http:'",
    "endpoint.hostname !== '127.0.0.1'",
    "receipt.mutationLog !== 'ollama/mutations.jsonl'",
    'ready?.copilotEnabled !== true',
    "integration: 'ollama'",
    "authKind: 'none'",
    "wireApi: 'completions'",
  ]) {
    assert.ok(fixture.includes(contract), `Ollama fixture misses ${contract}`)
  }
  assert.ok(!fixture.includes('TokenStore'))

  const seedStart = source.indexOf('async function seedProfile()')
  const seedEnd = source.indexOf('async function ensureRepository(', seedStart)
  const seed = source.slice(seedStart, seedEnd)
  assert.ok(seed.includes("'language-mode-v1': 'english'"))
  assert.ok(seed.includes("localStorage.removeItem('autoSwitchTheme')"))
  assert.ok(seed.includes("localStorage.getItem('copilot-byok-providers')"))
  assert.ok(seed.includes("localStorage.setItem('copilot-byok-providers'"))
  assert.ok(!seed.includes('TokenStore'))

  const manager = sceneSource('ollama-manager')
  for (const contract of [
    'await setViewport(1452, 1001)',
    "setThemeThroughToggle('dark')",
    'await captureSettingsTab(',
    "'Copilot'",
    "clickText('Providers'",
    "clickText('Manage models'",
    'material-ollama-model-manager',
    'ollama-endpoint-status',
    'ollama-refresh',
    "refresh.textContent.trim() === 'Refresh'",
    'ollama-pull-progress',
    'ollama-pull-cancel',
    'material-code:1.5b',
    'material-gallery-copy:latest',
    'ollama-copy',
    'ollama-load',
    'ollama-unload',
    'ollama-delete-dialog',
    'ollama-delete-confirm',
    "'pull-cancelled'",
    "'/__fixture__/reset'",
    'assertBaseOllamaFixtureState(finalReset',
    "document.body.classList.contains('theme-dark')",
    "localStorage.getItem('theme') === 'dark'",
    'window.innerWidth === 1452 && window.innerHeight === 1001',
    'document.querySelector(\'[data-verification="ollama-notice"]\') === null',
    'finally {',
    "setThemeThroughToggle('system')",
    "setThemeThroughToggle('light')",
    'await restoreCaptureViewport()',
    'post-scroll stable Ollama capture surface',
  ]) {
    assert.ok(manager.includes(contract), `Ollama scene misses ${contract}`)
  }
  assert.ok(
    source.includes('\'button.theme-toggle-button[aria-label="Toggle theme"]\'')
  )
  for (const model of [
    'material-chat:7b',
    'material-embed:latest',
    'material-vision:3b',
  ]) {
    assert.ok(manager.includes(model), `Ollama scene misses ${model}`)
  }
  assert.ok(!manager.includes('TokenStore'))

  const viewport = manager.indexOf('await setViewport(1452, 1001)')
  const capture = manager.indexOf('material-ollama-model-manager')
  const restoration = manager.lastIndexOf('await restoreCaptureViewport()')
  assert.ok(viewport >= 0 && viewport < capture && capture < restoration)
})

test('both pull-request scenes refresh the non-empty origin/main comparison', () => {
  for (const name of ['pull-request-compose', 'pull-request-open']) {
    const scene = sceneSource(name)
    for (const contract of [
      'ensurePullRequestMergeBase()',
      "clickSelector('.open-pull-request .popover-dropdown-component > button')",
      'clickPointerSelector(',
      '[role="option"][aria-label^="origin/main"]',
      'base:origin[/]main',
      "document.querySelector('.pull-request-files-changed')",
    ]) {
      assert.ok(scene.includes(contract), `${name} misses ${contract}`)
    }
  }
})

test('native pull-request capture waits for final clean mergeability', () => {
  const scene = sceneSource('pull-request-compose')
  for (const contract of [
    "document.querySelector('.open-pull-request .pr-merge-status-clean')",
    "clean.textContent?.includes('Able to merge.') === true",
    "document.querySelector('.open-pull-request .pr-merge-status-loading') === null",
    "document.querySelector('.open-pull-request .pr-merge-status-invalid') === null",
    "document.querySelector('.open-pull-request .pr-merge-status-conflicts') === null",
    'stable clean pull-request mergeability',
  ]) {
    assert.ok(
      scene.includes(contract),
      `PR mergeability gate misses ${contract}`
    )
  }
  assert.ok(
    scene.indexOf('stable clean pull-request mergeability') <
      scene.indexOf("capture('material-native-pull-request')")
  )
})

test('history power-tools capture proves a positive fixture result', () => {
  const scene = sceneSource('history-power-tools')
  for (const contract of [
    "setInput('input[placeholder*=\"Search commits\"]', 'submodules')",
    "document.querySelectorAll('#commit-list .commit')",
    "commit.querySelector('.summary')",
    "summaries[0] === 'Add deterministic initialized and dormant submodules'",
    "!historyText.includes('No matching commits')",
    'positive submodule history search result',
  ]) {
    assert.ok(
      scene.includes(contract),
      `history result gate misses ${contract}`
    )
  }
  assert.ok(
    scene.indexOf('positive submodule history search result') <
      scene.indexOf("capture('material-history-power-tools')")
  )
})

test('native pull-request review handles aria-only disablement at most once', () => {
  const helperStart = source.indexOf('async function clickTextWhenEnabled(')
  const helperEnd = source.indexOf(
    '\nasync function clickSelector(',
    helperStart
  )
  assert.notEqual(helperStart, -1)
  assert.notEqual(helperEnd, -1)
  const helper = source.slice(helperStart, helperEnd)
  assert.ok(!helper.includes('waitFor('))
  assert.ok(!helper.includes('catch'))
  const scene = sceneSource('pull-request-open')
  for (const contract of [
    'const clicked = await evaluate(',
    "candidate.getAttribute('aria-disabled') !== 'true' &&",
    '!candidate.disabled',
    'target.click()',
    'if (clicked) {',
    'await sleep(300)',
  ]) {
    assert.ok(
      helper.includes(contract),
      `atomic text action misses ${contract}`
    )
  }
  assert.match(helper, /target\.click\(\)\s+return true/)
  assert.match(helper, /if \(clicked\) \{\s+return\s+\}/)
  assert.equal(helper.match(/target\.click\(\)/g)?.length, 1)
  assert.equal(source.match(/await clickTextWhenEnabled\(/g)?.length, 1)
  assert.ok(scene.includes("clickTextWhenEnabled('Review pull request'"))
  assert.ok(scene.includes("within: '#create-github-pull-request'"))
  assert.ok(scene.includes('timeout: 30000'))
  assert.ok(!scene.includes("'enabled pull-request review action'"))
  assert.ok(!scene.includes("clickText('Review pull request'"))

  const reviewGuard = scene.indexOf(
    "const afterReview = countProviderRequests('POST', pullRequestPath)"
  )
  const providerMutation = scene.indexOf(
    "clickText('Create pull request'",
    reviewGuard
  )
  assert.notEqual(reviewGuard, -1)
  assert.notEqual(providerMutation, -1)
  assert.ok(scene.includes('if (afterReview !== before)'))
  assert.ok(
    reviewGuard < providerMutation,
    'the non-mutating Review guard must precede Create'
  )
})

test('canonical workflow scenes use current reviewed controls and outcomes', () => {
  for (const contract of [
    "clickText('Sync repositories')",
    "clickText('Start pull'",
    'Every repository has a final result.',
    '\'[data-hub-tool="shallow-history"]\'',
    "clickText('Check history status'",
    "clickText('Review bounded deepen'",
    "clickText('Deepen by 1 commits'",
    'Fetched 1 additional commits of history from origin.',
    "clickText('Review full history'",
    "clickText('Fetch full history'",
    'This repository is no longer shallow.',
    "clickSelector('.history-filter-chips-toggle')",
    "clickSelector('.history-regex-builder-chip')",
    "document.querySelector('#regex-builder-title')",
    '\'#choose-branch [role="option"][aria-label^="origin/main"]\'',
    "document.querySelector('.rebase-route')",
    "document.querySelector('.rebase-ahead-behind')",
    "document.querySelector('.rebase-commit-preview')",
    '[role="group"][aria-label="Create commit"] input[placeholder="Summary (required)"]',
    "const recoveryBranch = 'gallery/stale-lock-evidence'",
    "'enabled stale-lock commit action'",
    "clickEnabledSelector('.commit-button')",
    "'restored canonical fixture branch'",
  ]) {
    assert.ok(source.includes(contract), `missing reviewed state: ${contract}`)
  }
  for (const stale of [
    "clickText('Pull all'",
    'Fetch 25 older commits',
    'Deepen by 25',
    'Fetch all remaining history',
    'Review deployments',
    'input[aria-label="Commit summary"]',
  ]) {
    assert.ok(!source.includes(stale), `stale control remains: ${stale}`)
  }
})

test('repository sheet capture rejects clipped batch actions', () => {
  const scene = sceneSource('repositories-sheet')
  for (const contract of [
    "document.querySelector('#foldout-container .foldout')",
    "document.querySelector('.repository-list-actions')",
    "['Sync repositories', 'Commit & push all', 'Add']",
    'button.right > actionLayout.sheet.right + 0.5',
    'Repository sheet clips or omits actions',
  ]) {
    assert.ok(scene.includes(contract), `repository sheet misses ${contract}`)
  }
  assert.ok(
    scene.indexOf('Repository sheet clips or omits actions') <
      scene.indexOf("capture('material-repositories-sheet')"),
    'the layout gate must run before capture'
  )
})

test('branch sheet capture rejects clipped or overlapping footer actions', () => {
  const scene = sceneSource('branches-sheet')
  for (const contract of [
    "document.querySelector('#foldout-container .foldout')",
    "document.querySelector('.branches-container .merge-button-row')",
    "'.branches-container .merge-all-button'",
    "'.branches-container .new-branch-button'",
    'layout.row.scrollWidth > layout.row.clientWidth + 1',
    'intersects(layout.newBranch, layout.merge)',
    'Branch sheet controls are clipped or overlapping',
  ]) {
    assert.ok(scene.includes(contract), `branch sheet misses ${contract}`)
  }
  assert.ok(
    scene.indexOf('Branch sheet controls are clipped or overlapping') <
      scene.indexOf("capture('material-branches-sheet')"),
    'the branch layout gate must run before capture'
  )
})

test('Actions captures prove inspector pagination, logs, reviews, and cancellation', () => {
  for (const contract of [
    'async function openInspectorRun()',
    'async function loadInspectorPageTwo()',
    "document.querySelector('.actions-run-list')",
    "document.querySelector('.actions-content')",
    'content.scrollTop = 0',
    'details.scrollTop = 0',
    'requestAnimationFrame(() => requestAnimationFrame(',
    "run.getAttribute('aria-pressed') === 'true'",
    'cards?.length === 50',
    'contentBounds.height > 300',
    'inside(runBounds, listBounds)',
    'inside(titleBounds, detailsBounds)',
    'inside(detailsBounds, contentBounds)',
    'inside(paginationBounds, detailsBounds)',
    'visible Actions inspector split panes',
    "scene('actions-sentinel'",
    "within: '.actions-run-details'",
    "document.querySelector('.actions-run-list')",
    "button.querySelector('.actions-run-summary strong')",
    "card.querySelector('.actions-run-number')?.textContent?.trim() === '#125'",
    "document.querySelector('.actions-run-details') === null",
    'inside(cardBounds, listBounds)',
    'visible exact Actions inspector sentinel',
    '50 loaded of ${ready.workflowRunCount} workflow runs',
    'Page-two current-attempt Windows packaging sentinel',
    'Exact workflow job ${ready?.inspectorCurrentJobSentinelId}',
    '[aria-label="Cancel workflow run 74"]',
    "clickText('Keep current state'",
    "document.querySelectorAll('.actions-pending-environment').length === 2",
    'Locked deployment environment',
  ]) {
    assert.ok(
      source.includes(contract),
      `missing Actions contract: ${contract}`
    )
  }
  assert.match(
    source,
    /50 loaded of \$\{\s*ready\.inspectorJobCount\s*\} jobs for attempt 2/
  )
  for (const retainedState of [
    'const runInventoryComplete',
    'if (!runInventoryComplete)',
    '${ready.workflowRunCount} loaded of ${ready.workflowRunCount} workflow runs',
    '${ready.inspectorJobCount} loaded of ${ready.inspectorJobCount} jobs for attempt 2',
  ]) {
    assert.ok(
      source.includes(retainedState),
      `missing retained state: ${retainedState}`
    )
  }
  assert.ok(!source.includes('WARN no cancellable run found'))
})

test('artifact page-two capture targets its exact card inside the details pane', () => {
  const artifactPageTwo = sceneSource('actions-artifact-page-two')
  for (const contract of [
    'exact page-one artifact inventory and enabled pagination action',
    'const pageOneArtifactCount = ready.artifactCount - 1',
    'const pageOneArtifactStatus = `Showing ${pageOneArtifactCount} loaded of ${ready.artifactCount} artifacts.`',
    'const status = pagination?.querySelector(\'[role="status"]\')',
    "candidate.textContent?.trim() === 'Load more artifacts'",
    'button instanceof HTMLButtonElement',
    '!button.disabled',
    "button.getAttribute('aria-disabled') !== 'true'",
    "within: '.actions-run-details .actions-artifacts'",
    "'#actions-artifact-${",
    'ready.artifactSentinelId',
    'ready.artifactCount',
    'page-two-artifact-sentinel-with-a-deliberately-long-name-that-must-wrap-without-clipping-overlap-or-sideways-scrolling',
    'complete exact artifact page-two inventory',
    "document.querySelector('.actions-content')",
    'content.scrollTop = 0',
    'details.scrollTop += headingBounds.top - detailsBounds.top',
    "heading?.closest('.actions-artifact-card')",
    "'.actions-run-reviews .actions-inline-error'",
    'visibleReviewErrors.length === 0',
    'details.scrollWidth <= details.clientWidth + 1',
    'grid.scrollWidth <= grid.clientWidth + 1',
    'visible exact artifact page-two sentinel',
  ]) {
    assert.ok(
      artifactPageTwo.includes(contract),
      `artifact page-two gate misses ${contract}`
    )
  }
  assert.match(
    artifactPageTwo,
    /status\?\.textContent\?\.trim\(\) === \$\{JSON\.stringify\(\s*pageOneArtifactStatus\s*\)\}/
  )
  assert.match(
    artifactPageTwo,
    /querySelectorAll\('#actions-artifact-grid \.actions-artifact-card'\)\.length ===\s*\$\{pageOneArtifactCount\}/
  )
  assert.match(
    artifactPageTwo,
    /querySelector\('#actions-artifact-\$\{\s*ready\.artifactSentinelId\s*\}'\) === null/
  )
  const open = artifactPageTwo.indexOf('await openFirstRun()')
  const pageOne = artifactPageTwo.indexOf(
    'exact page-one artifact inventory and enabled pagination action'
  )
  const loadMore = artifactPageTwo.indexOf("clickText('Load more artifacts'")
  assert.ok(open >= 0 && open < pageOne && pageOne < loadMore)
  assert.ok(
    artifactPageTwo.indexOf('visible exact artifact page-two sentinel') <
      artifactPageTwo.indexOf("capture('material-actions-artifact-page-two')"),
    'the exact artifact and error gate must run before capture'
  )
})

test('advanced workflow and Cheap-LFS scenes use exact enabled controls', () => {
  const advanced = sceneSource('advanced-workflows')
  const advancedSelector =
    '.tag-lifecycle-manager > header .tag-lifecycle-actions button:nth-of-type(2)'
  assert.ok(advanced.includes(advancedSelector))
  assert.ok(advanced.includes("?.textContent?.trim() === 'Load remote'"))
  assert.ok(advanced.includes("getAttribute('aria-disabled') !== 'true'"))
  assert.ok(advanced.includes('clickEnabledSelector(loadRemoteSelector)'))
  assert.ok(!advanced.includes("clickText('Load remote'"))

  const cheap = sceneSource('cheap-lfs-preparing')
  const checkout = cheap.indexOf("'checkout',")
  const create = cheap.indexOf("fs.openSync(largeFilePath, 'wx')")
  const cleanBase = cheap.indexOf("baseStatus !== ''")
  const exactPreparedStatus = cheap.indexOf(
    'preparedStatus[0] !== `?? ${largeFileName}`'
  )
  assert.notEqual(checkout, -1)
  assert.notEqual(create, -1)
  assert.notEqual(cleanBase, -1)
  assert.notEqual(exactPreparedStatus, -1)
  assert.ok(checkout < cleanBase)
  assert.ok(cleanBase < create)
  assert.ok(create < exactPreparedStatus)
  for (const contract of [
    "const cheapLfsBranch = 'gallery/cheap-lfs-evidence'",
    'assertOwnedDisposableFixture()',
    'const cheapLfsBaseRef = `refs/heads/${ready.featureBranch}^{commit}`',
    "'rev-parse', '--verify', cheapLfsBaseRef",
    "'branch', '--show-current'",
    "'status', '--porcelain=v1', '--untracked-files=all'",
    'checkedOutHead !== cheapLfsBaseHead',
    'preparedStatus.length !== 1',
    'isolated Cheap-LFS evidence branch',
    "setInput('.summary-field input'",
    "getAttribute('aria-disabled') !== 'true'",
    "clickEnabledSelector('.commit-button')",
    'Preparing 1 large file for cheap LFS',
  ]) {
    assert.ok(cheap.includes(contract), `Cheap-LFS misses ${contract}`)
  }
  assert.match(
    cheap,
    /'checkout',\s*'--quiet',\s*'-B',\s*cheapLfsBranch,\s*cheapLfsBaseRef/
  )
})

test('advanced workflow seeds and proves the exact owned tag topology', () => {
  const helperStart = source.indexOf(
    'function prepareAdvancedWorkflowTagFixture()'
  )
  const helperEnd = source.indexOf('const DefaultWidth', helperStart)
  assert.notEqual(helperStart, -1)
  assert.notEqual(helperEnd, -1)
  const helper = source.slice(helperStart, helperEnd)
  for (const contract of [
    'assertOwnedDisposableFixture()',
    'fs.realpathSync.native(path.resolve(runRoot))',
    'ownedBare = fs.realpathSync.native(',
    "'git-http'",
    'const bareInsideRunRoot =',
    "relativeFixture.toLowerCase() !== 'fixture'",
    'relativeBare.toLowerCase() !== expectedBare.toLowerCase()',
    "'--is-inside-work-tree'",
    "'--is-bare-repository'",
    '`refs/remotes/origin/${ready.defaultBranch}^{commit}`',
    '`refs/remotes/origin/${ready.featureBranch}^{commit}`',
    "runAdvancedWorkflowGit(ownedBare, ['update-ref', '-d', tagRef])",
    'GIT_COMMITTER_DATE: taggerDate',
    "'preview-local'",
    "'v1.0.0'",
    "'v1.1.0'",
    "'archive-remote'",
    "'refs/tags/v1.0.0:refs/tags/v1.0.0'",
    "'refs/tags/v1.1.0:refs/tags/v1.1.0'",
    "'refs/tags/archive-remote:refs/tags/archive-remote'",
    "JSON.stringify(pushed) !== JSON.stringify(['v1.0.0', 'v1.1.0'])",
    "JSON.stringify(localOnly) !== JSON.stringify(['preview-local'])",
    "JSON.stringify(remoteOnly) !== JSON.stringify(['archive-remote'])",
    'ADVANCED_TAG_FIXTURE',
  ]) {
    assert.ok(
      helper.includes(contract),
      `tag fixture helper misses ${contract}`
    )
  }

  const advanced = sceneSource('advanced-workflows')
  const seed = advanced.indexOf('prepareAdvancedWorkflowTagFixture()')
  const repository = advanced.indexOf('await ensureRepository()')
  const capture = advanced.indexOf("capture('advanced-workflows')")
  assert.ok(seed >= 0 && seed < repository)
  for (const contract of [
    'Local tags (3)',
    'Remote-only tags (1) on origin',
    '["preview-local","v1.0.0","v1.1.0"]',
    '["archive-remote"]',
    "textByName.get('preview-local')?.includes('Local only') === true",
    "textByName.get('v1.0.0')?.includes('Pushed') === true",
    "textByName.get('v1.1.0')?.includes('Pushed') === true",
    "textByName.get('archive-remote')?.includes('remote only') === true",
    'row.withinViewport',
    'row.withinResultsColumn',
    'row.withinInventoryHorizontally',
    '!row.horizontalOverflow',
    'row.buttonsWithinRow',
    '!row.buttonsOverlap',
    'receipt.visibleErrors.length !== 0',
    'Advanced workflows failed semantic/geometry/privacy checks',
  ]) {
    assert.ok(advanced.includes(contract), `advanced gate misses ${contract}`)
  }
  assert.ok(
    advanced.indexOf('const rowsHaveValidGeometry =') < capture,
    'the semantic and geometry receipt must run before capture'
  )
})

test('advanced workflow Git subprocesses are bounded and hermetic', () => {
  const redirectEnvironmentNames = frozenStringArray(
    'AdvancedWorkflowGitRedirectEnvironmentNames'
  )
  const requiredRedirectEnvironmentNames = [
    'GIT_ALTERNATE_OBJECT_DIRECTORIES',
    'GIT_CEILING_DIRECTORIES',
    'GIT_COMMON_DIR',
    'GIT_DIR',
    'GIT_DISCOVERY_ACROSS_FILESYSTEM',
    'GIT_EXEC_PATH',
    'GIT_GLOB_PATHSPECS',
    'GIT_GRAFT_FILE',
    'GIT_ICASE_PATHSPECS',
    'GIT_IMPLICIT_WORK_TREE',
    'GIT_INDEX_FILE',
    'GIT_INTERNAL_SUPER_PREFIX',
    'GIT_LITERAL_PATHSPECS',
    'GIT_NAMESPACE',
    'GIT_NOGLOB_PATHSPECS',
    'GIT_NO_REPLACE_OBJECTS',
    'GIT_OBJECT_DIRECTORY',
    'GIT_PREFIX',
    'GIT_QUARANTINE_PATH',
    'GIT_REDIRECT_STDERR',
    'GIT_REDIRECT_STDIN',
    'GIT_REDIRECT_STDOUT',
    'GIT_REPLACE_REF_BASE',
    'GIT_SHALLOW_FILE',
    'GIT_SUPER_PREFIX',
    'GIT_TEMPLATE_DIR',
    'GIT_WORK_TREE',
  ]
  assert.deepEqual(redirectEnvironmentNames, requiredRedirectEnvironmentNames)
  assert.equal(
    new Set(redirectEnvironmentNames).size,
    redirectEnvironmentNames.length,
    'Git redirection environment names must remain unique'
  )

  const helperStart = source.indexOf(
    'const AdvancedWorkflowGitTimeoutMs = 30_000'
  )
  const helperEnd = source.indexOf(
    'function readAdvancedWorkflowTagRefs(',
    helperStart
  )
  assert.notEqual(helperStart, -1)
  assert.notEqual(helperEnd, -1)
  const helper = source.slice(helperStart, helperEnd)

  for (const contract of [
    'const AdvancedWorkflowGitMaxBufferBytes = 1024 * 1024',
    "const AdvancedWorkflowGitNullDevice = 'NUL'",
    'const environment = { ...process.env, ...overrides }',
    'const normalizedKey = key.toUpperCase()',
    '/^GIT_CONFIG(?:_|$)/.test(normalizedKey)',
    '/^GIT_TRACE(?:2)?(?:_|$)/.test(normalizedKey)',
    'AdvancedWorkflowGitRedirectEnvironmentNames.includes(normalizedKey)',
    'delete environment[key]',
    'GIT_CONFIG_GLOBAL: AdvancedWorkflowGitNullDevice',
    'GIT_CONFIG_SYSTEM: AdvancedWorkflowGitNullDevice',
    "GIT_CONFIG_NOSYSTEM: '1'",
    "'tag.gpgSign=false'",
    "'push.gpgSign=false'",
    '`core.hooksPath=${AdvancedWorkflowGitNullDevice}`',
    'env: getAdvancedWorkflowGitEnvironment(environmentOverrides)',
    'timeout: AdvancedWorkflowGitTimeoutMs',
    'maxBuffer: AdvancedWorkflowGitMaxBufferBytes',
  ]) {
    assert.ok(helper.includes(contract), `tag Git helper misses ${contract}`)
  }
  const callerOptions = helper.indexOf('...execOptions')
  const timeout = helper.indexOf('timeout: AdvancedWorkflowGitTimeoutMs')
  const maxBuffer = helper.indexOf(
    'maxBuffer: AdvancedWorkflowGitMaxBufferBytes'
  )
  assert.ok(callerOptions >= 0 && callerOptions < timeout)
  assert.ok(callerOptions < maxBuffer)

  const inheritedEnvironment = Object.fromEntries(
    redirectEnvironmentNames.map((name, index) => [
      index % 2 === 0 ? name : name.toLowerCase(),
      `inherited-${index}`,
    ])
  )
  inheritedEnvironment.GIT_CONFIG_COUNT = '1'
  inheritedEnvironment.GIT_CONFIG_KEY_0 = 'core.hooksPath'
  inheritedEnvironment.GIT_CONFIG_VALUE_0 = 'inherited-hook-path'
  inheritedEnvironment.Git_Trace = 'inherited-trace-path'
  inheritedEnvironment.git_trace2_event = 'inherited-trace2-path'
  inheritedEnvironment.GIT_COMMITTER_NAME = 'Inherited identity'
  inheritedEnvironment.SAFE_CAPTURE_SENTINEL = 'inherited-safe-value'
  const getEnvironment = vm.runInNewContext(
    `(() => { ${helper}; return getAdvancedWorkflowGitEnvironment })()`,
    { process: { env: inheritedEnvironment } }
  )
  const sanitizedEnvironment = getEnvironment({
    git_dir: 'override-repository',
    git_config_global: 'override-config',
    GIT_COMMITTER_NAME: 'Material Fixture',
    GIT_COMMITTER_EMAIL: 'material-fixture@example.invalid',
    GIT_COMMITTER_DATE: '2026-07-13T10:24:00Z',
    SAFE_OVERRIDE_SENTINEL: 'override-safe-value',
  })
  for (const name of redirectEnvironmentNames) {
    assert.equal(
      Object.keys(sanitizedEnvironment).some(key => key.toUpperCase() === name),
      false,
      `${name} escaped Git environment isolation`
    )
  }
  assert.equal(
    Object.keys(sanitizedEnvironment).some(key =>
      /^GIT_TRACE(?:2)?(?:_|$)/.test(key.toUpperCase())
    ),
    false,
    'Git trace output escaped environment isolation'
  )
  assert.equal(
    Object.keys(sanitizedEnvironment).some(key =>
      /^GIT_CONFIG(?:_|$)/.test(key.toUpperCase())
    ),
    true,
    'only the fixed Git configuration variables should survive isolation'
  )
  assert.deepEqual(
    Object.fromEntries(
      Object.entries(sanitizedEnvironment).filter(([key]) =>
        /^GIT_CONFIG(?:_|$)/.test(key.toUpperCase())
      )
    ),
    {
      GIT_CONFIG_GLOBAL: 'NUL',
      GIT_CONFIG_SYSTEM: 'NUL',
      GIT_CONFIG_NOSYSTEM: '1',
    }
  )
  assert.equal(sanitizedEnvironment.GIT_COMMITTER_NAME, 'Material Fixture')
  assert.equal(
    sanitizedEnvironment.GIT_COMMITTER_EMAIL,
    'material-fixture@example.invalid'
  )
  assert.equal(sanitizedEnvironment.GIT_COMMITTER_DATE, '2026-07-13T10:24:00Z')
  assert.equal(
    sanitizedEnvironment.SAFE_CAPTURE_SENTINEL,
    'inherited-safe-value'
  )
  assert.equal(
    sanitizedEnvironment.SAFE_OVERRIDE_SENTINEL,
    'override-safe-value'
  )

  const fixtureStart = source.indexOf(
    'function prepareAdvancedWorkflowTagFixture()'
  )
  const fixtureEnd = source.indexOf('const DefaultWidth', fixtureStart)
  assert.notEqual(fixtureStart, -1)
  assert.notEqual(fixtureEnd, -1)
  const fixture = source.slice(fixtureStart, fixtureEnd)
  for (const contract of ["'--no-sign'", "'--no-signed'", "'--no-verify'"]) {
    assert.ok(
      fixture.includes(contract),
      `tag fixture command misses ${contract}`
    )
  }
  assert.match(fixture, /'tag',\s*'--no-sign',\s*'--annotate',\s*'--force'/)
  assert.match(fixture, /'push',\s*'--no-signed',\s*'--no-verify',\s*'--force'/)
})

test('requested 200% scale proves the base and a lower auto-fit factor', () => {
  const scale = sceneSource('scale-200')
  for (const contract of [
    "Number(localStorage.getItem('zoom-factor')) === 2",
    "localStorage.getItem('zoom-auto-fit-enabled') === '1'",
    "require('electron').webFrame.getZoomFactor() >= 0.5",
    "require('electron').webFrame.getZoomFactor() < 2",
    "await capture('material-scale-200-autofit')",
  ]) {
    assert.ok(scale.includes(contract), `scale-200 misses ${contract}`)
  }
  assert.ok(!scale.includes('getZoomFactor() * 100) === 200'))
})

test('capture scenes prove PR, sparse, scale, merge, and distinct artifact states', () => {
  for (const contract of [
    "setInput('.sparse-checkout-editor', 'docs/')",
    "document.querySelector('.sparse-checkout-confirmation')",
    "document.querySelector('.pull-request-files-changed')",
    "document.querySelector('#create-github-pull-request')",
    "clickTextWhenEnabled('Review pull request'",
    "clickText('Create pull request'",
    'const expectedPullRequestNumber = 73 + before',
    'const expectedPullRequestReceipt =',
    "countProviderRequests('POST', pullRequestPath)",
    "document.querySelector('#merge-all .merge-all-summary')",
    "document.querySelectorAll('#merge-all .merge-all-results tbody tr')",
    'sha256File(pageTwo) === sha256File(inventory)',
  ]) {
    assert.ok(
      source.includes(contract),
      `missing outcome contract: ${contract}`
    )
  }
  assert.match(
    source,
    /JSON\.stringify\(\r?\n\s+expectedPullRequestReceipt/,
    'the native pull-request receipt must be evaluated exactly'
  )
  assert.match(
    source,
    /scene\('scale-200',[\s\S]*?for \(let index = 0; index < 5; index\+\+\)/
  )
})
