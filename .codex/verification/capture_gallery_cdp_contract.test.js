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
  assert.ok(!source.includes("args.get('out') ?? 'docs/assets/screenshots'"))
})
