#!/usr/bin/env node
'use strict'

/**
 * Gallery screenshot driver for the unpackaged production build.
 *
 * Launches out/main.js with Playwright's Electron driver against the isolated
 * P0 fixture profile (owned APPDATA/HOME under the run root), keeps the
 * window far off the visible desktop, seeds the deterministic provider
 * account, and walks named scenes that recreate every Feature-Gallery
 * surface before capturing it to docs/assets/screenshots.
 *
 * Usage:
 *   node .codex/verification/capture_gallery_playwright.js \
 *     --run-root %TEMP%\desktop-material-p0-ui-... \
 *     --scenes workspace-changes,history [--out docs/assets/screenshots]
 *   node ... --probe "expression"   (evaluate in the renderer and print)
 *   node ... --list                 (list scene names)
 */

const fs = require('fs')
const path = require('path')
const { _electron } = require('playwright')

const repoRoot = path.resolve(__dirname, '..', '..')

function fail(message) {
  throw new Error(message)
}

function parseArguments(argv) {
  const values = new Map()
  for (let index = 0; index < argv.length; index += 2) {
    const name = argv[index]
    const value = argv[index + 1]
    if (!name?.startsWith('--') || value === undefined) {
      fail(`Invalid argument near ${name ?? '<end>'}.`)
    }
    values.set(name.slice(2), value)
  }
  return values
}

const args = parseArguments(process.argv.slice(2))
const runRoot = args.get('run-root')
const outDir = path.resolve(repoRoot, args.get('out') ?? 'docs/assets/screenshots')

if (!runRoot || !fs.existsSync(runRoot)) {
  if (!args.has('list')) {
    fail('A prepared --run-root is required.')
  }
}

const ready = runRoot
  ? JSON.parse(
      fs.readFileSync(path.join(runRoot, 'provider', 'ready.json'), 'utf8')
    )
  : null
const fixturePath = runRoot ? path.join(runRoot, 'fixture') : null
const fixtureSourcePath = runRoot ? path.join(runRoot, 'git-source') : null

const account = ready
  ? {
      endpoint: ready.endpoint.replace(/\/$/, ''),
      login: 'material-verifier-p0',
      id: 7130701,
    }
  : null

/** Default gallery viewport (client area). */
const DefaultWidth = 1440
const DefaultHeight = 960

let electronApp = null
let page = null

async function launch() {
  const profileDir = path.join(runRoot, 'profile')
  const localDir = path.join(runRoot, 'profile-local')
  const homeDir = path.join(runRoot, 'home')
  for (const dir of [profileDir, localDir, homeDir]) {
    fs.mkdirSync(dir, { recursive: true })
  }

  electronApp = await _electron.launch({
    executablePath: path.join(
      repoRoot,
      'node_modules',
      'electron',
      'dist',
      'electron.exe'
    ),
    args: [
      path.join(repoRoot, 'out', 'main.js'),
      // Off-screen windows must keep painting for CDP captures.
      '--disable-features=CalculateNativeWinOcclusion',
    ],
    env: {
      ...process.env,
      NODE_ENV: 'production',
      APPDATA: profileDir,
      LOCALAPPDATA: localDir,
      HOME: homeDir,
      USERPROFILE: homeDir,
    },
    cwd: repoRoot,
  })

  page = await electronApp.firstWindow()
  await page.waitForLoadState('domcontentloaded')

  // Keep every window far away from the visible desktop.
  await electronApp.evaluate(({ BrowserWindow }) => {
    for (const win of BrowserWindow.getAllWindows()) {
      win.setPosition(-4200, 120)
    }
  })
  await setContentSize(DefaultWidth, DefaultHeight)
}

async function setContentSize(width, height) {
  await electronApp.evaluate(
    ({ BrowserWindow }, { width, height }) => {
      const win = BrowserWindow.getAllWindows()[0]
      win.setContentSize(width, height)
    },
    { width, height }
  )
}

async function menuEvent(name) {
  await electronApp.evaluate(({ BrowserWindow }, name) => {
    const win = BrowserWindow.getAllWindows()[0]
    win.webContents.send('menu-event', name)
  }, name)
}

async function seedProfile() {
  const users = JSON.stringify([
    {
      token: '',
      login: account.login,
      endpoint: account.endpoint,
      emails: [
        {
          email: 'material-verifier@example.invalid',
          verified: true,
          primary: true,
          visibility: 'private',
        },
      ],
      avatarURL: '',
      id: account.id,
      name: 'Material Verification Account',
      plan: 'enterprise',
      provider: 'github',
    },
  ])
  return page.evaluate(users => {
    const expected = {
      'has-shown-welcome-flow': '1',
      theme: 'light',
      'zoom-auto-fit-enabled': '1',
      'stats-opt-out': '1',
      'has-sent-stats-opt-in-ping': '1',
    }
    let changed = false
    for (const [key, value] of Object.entries(expected)) {
      if (localStorage.getItem(key) !== value) {
        localStorage.setItem(key, value)
        changed = true
      }
    }
    const expectedUsers = JSON.parse(users)
    let storedUsers = []
    try {
      storedUsers = JSON.parse(localStorage.getItem('users') || '[]')
    } catch {}
    const expectedAccount = expectedUsers[0]
    const accountPresent =
      Array.isArray(storedUsers) &&
      storedUsers.some(
        value =>
          value?.provider === expectedAccount.provider &&
          value?.endpoint === expectedAccount.endpoint &&
          value?.login === expectedAccount.login &&
          value?.id === expectedAccount.id
      )
    if (!accountPresent) {
      localStorage.setItem('users', JSON.stringify(expectedUsers))
      changed = true
    }
    return changed
  }, users)
}

async function reloadApp() {
  await page.evaluate(() => window.location.reload())
  await page.waitForLoadState('domcontentloaded')
  await page.waitForTimeout(3500)
}

async function settle(ms = 700) {
  await page.waitForTimeout(ms)
}

async function pressEscape(times = 1) {
  for (let index = 0; index < times; index++) {
    await page.keyboard.press('Escape')
    await settle(250)
  }
}

async function capture(name) {
  fs.mkdirSync(outDir, { recursive: true })
  const file = path.join(outDir, `${name}.png`)
  await page.screenshot({ path: file })
  const { width, height } = page.viewportSize() ?? {}
  process.stdout.write(`CAPTURED ${name}.png ${width}x${height}\n`)
}

/** Click the first button whose trimmed text matches. */
async function clickButtonByText(label, options = {}) {
  const clicked = await page.evaluate(
    ({ label, within }) => {
      const scope = within ? document.querySelector(within) : document
      if (!scope) return false
      const button = [...scope.querySelectorAll('button')].find(
        value =>
          value.textContent.trim() === label &&
          value.getAttribute('aria-disabled') !== 'true' &&
          !value.disabled
      )
      if (!button) return false
      button.scrollIntoView({ block: 'nearest', inline: 'nearest' })
      button.click()
      return true
    },
    { label, within: options.within ?? null }
  )
  if (!clicked && options.optional !== true) {
    fail(`Unable to activate button "${label}".`)
  }
  return clicked
}

/**
 * The scene registry. Each scene prepares one Feature-Gallery surface and
 * captures its canonical PNG. Scenes must dismiss what they open.
 */
const scenes = new Map()

function scene(name, run) {
  scenes.set(name, run)
}

// Scenes are registered in ./capture_gallery_scenes.js to keep this driver
// small; it receives the toolkit as its argument.
const toolkit = {
  get page() {
    return page
  },
  get electronApp() {
    return electronApp
  },
  get ready() {
    return ready
  },
  get fixturePath() {
    return fixturePath
  },
  get fixtureSourcePath() {
    return fixtureSourcePath
  },
  repoRoot,
  scene,
  capture,
  settle,
  pressEscape,
  clickButtonByText,
  menuEvent,
  setContentSize,
  reloadApp,
  DefaultWidth,
  DefaultHeight,
}

require('./capture_gallery_scenes')(toolkit)

async function main() {
  if (args.has('list')) {
    for (const name of scenes.keys()) {
      process.stdout.write(`${name}\n`)
    }
    return
  }

  await launch()

  const changed = await seedProfile()
  if (changed) {
    await reloadApp()
  }

  if (args.has('probe')) {
    const value = await page.evaluate(args.get('probe'))
    process.stdout.write(`PROBE ${JSON.stringify(value, null, 2)}\n`)
  }

  const sceneNames =
    args.get('scenes') === 'all' || args.get('scenes') === undefined
      ? [...scenes.keys()]
      : args
          .get('scenes')
          .split(',')
          .map(value => value.trim())
          .filter(value => value.length > 0)

  for (const name of sceneNames) {
    const run = scenes.get(name)
    if (run === undefined) {
      fail(`Unknown scene: ${name}`)
    }
    process.stdout.write(`SCENE ${name}\n`)
    await run(toolkit)
  }

  await electronApp.close()
}

main().catch(async error => {
  process.stderr.write(
    `CAPTURE_FAIL ${error?.stack ?? String(error ?? 'unknown')}\n`
  )
  try {
    await electronApp?.close()
  } catch {}
  process.exit(1)
})
