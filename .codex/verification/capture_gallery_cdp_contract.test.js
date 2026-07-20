'use strict'

const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const test = require('node:test')

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
    "scene('app-identity'",
    '\'[data-customization-surface="app-identity"]\'',
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
    "getComputedStyle(content).overflowY === 'auto'",
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

test('provider triage capture waits for the exact settled surface', () => {
  const triage = sceneSource('provider-triage')
  for (const contract of [
    "document.querySelector('#triage-tab')",
    'closest(\'button[role="tab"]\')',
    "getAttribute('aria-selected') === 'true'",
    "document.querySelector('main.provider-triage-view')",
    "querySelectorAll('.provider-triage-channel.ready')",
    '/^\\\\d+ of \\\\d+ work items$/',
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
    'accountsStore.getAll()',
    'repositoryWithRefreshedGitHubRepository(repository)',
    'accountCount: accounts.length',
    'fixtureAccountMatched: fixtureAccount !== undefined',
    'fixtureTokenPresent:',
    'repositoryMatched: Boolean(freshRepository?.gitHubRepository)',
    'selectedRepositoryMatched: Boolean(',
  ]) {
    assert.ok(
      seed.includes(contract),
      `missing hydration contract: ${contract}`
    )
  }
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
  const checkout = cheap.indexOf("['-C', fixturePath, 'checkout'")
  const create = cheap.indexOf("fs.openSync(largeFilePath, 'wx')")
  assert.notEqual(checkout, -1)
  assert.notEqual(create, -1)
  assert.ok(checkout < create)
  for (const contract of [
    "const cheapLfsBranch = 'gallery/cheap-lfs-evidence'",
    "'--quiet', '-B', cheapLfsBranch",
    'isolated Cheap-LFS evidence branch',
    "setInput('.summary-field input'",
    "getAttribute('aria-disabled') !== 'true'",
    "clickEnabledSelector('.commit-button')",
    'Preparing 1 large file for cheap LFS',
  ]) {
    assert.ok(cheap.includes(contract), `Cheap-LFS misses ${contract}`)
  }
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
    "clickText('Review pull request'",
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
