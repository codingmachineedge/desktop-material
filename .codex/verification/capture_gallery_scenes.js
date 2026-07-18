'use strict'

/**
 * Feature-Gallery scene registry for capture_gallery_playwright.js.
 *
 * Every scene recreates one catalogued surface of the built app against the
 * deterministic P0 fixture and captures its canonical PNG name. Scenes are
 * additive-only against the live app: they open surfaces, capture, and close
 * what they opened.
 */

const fs = require('fs')
const path = require('path')

module.exports = toolkit => {
  const {
    scene,
    capture,
    settle,
    pressEscape,
    clickButtonByText,
    menuEvent,
    setContentSize,
    DefaultWidth,
    DefaultHeight,
  } = toolkit

  const page = () => toolkit.page

  /** Ensure the fixture repository is added and selected. Idempotent. */
  async function ensureRepository() {
    const hasRepository = await page().evaluate(
      () => document.querySelector('nav.repository-rail') !== null
    )
    if (hasRepository) {
      return
    }

    await menuEvent('add-local-repository')
    await page().waitForSelector('#add-existing-repository', { timeout: 8000 })
    const input = page().locator('#add-existing-repository input[type="text"]')
    await input.first().fill(toolkit.fixturePath)
    await settle(900)
    await clickButtonByText('Add repository', { optional: true })
    await clickButtonByText('Add Repository', { optional: true })
    await page().waitForSelector('nav.repository-rail', { timeout: 15000 })
    await settle(1200)
  }

  /** Switch to a repository section tab by its accessible label. */
  async function showSection(label) {
    const done = await page().evaluate(label => {
      const rail = document.querySelector('nav.repository-rail')
      if (!rail) return false
      const target = [...rail.querySelectorAll('button')].find(button => {
        const name =
          button.getAttribute('aria-label') ?? button.textContent ?? ''
        return name.trim().toLowerCase().startsWith(label.toLowerCase())
      })
      if (!target) return false
      target.click()
      return true
    }, label)
    if (!done) {
      throw new Error(`Unable to activate section ${label}.`)
    }
    await settle(900)
  }

  /** Print a summary of the current DOM for selector discovery. */
  scene('dump', async () => {
    const summary = await page().evaluate(() => {
      const texts = selector =>
        [...document.querySelectorAll(selector)].map(el => ({
          label: el.getAttribute('aria-label'),
          text: (el.textContent ?? '').trim().slice(0, 60),
          cls: el.className?.toString?.().slice(0, 80),
        }))
      return {
        title: document.title,
        railButtons: texts('nav.repository-rail button'),
        toolbarButtons: texts('.toolbar button, [class*="toolbar"] button'),
        dialogs: [...document.querySelectorAll('dialog')].map(d => d.id),
        topButtons: texts('body > * button').slice(0, 40),
      }
    })
    process.stdout.write(`DUMP ${JSON.stringify(summary, null, 2)}\n`)
  })

  scene('workspace-changes', async () => {
    await ensureRepository()

    // Deterministic uncommitted changes for the Changes surface.
    const fixture = toolkit.fixturePath
    fs.writeFileSync(
      path.join(fixture, 'material-notes.md'),
      '# Material verification notes\n\nDeterministic fixture change.\n'
    )
    fs.writeFileSync(
      path.join(fixture, 'docs-outline.md'),
      '# Outline\n\n- workspace\n- history\n'
    )
    await showSection('Changes')
    await settle(2200)
    await capture('material-workspace-changes')
  })

  scene('history', async () => {
    await ensureRepository()
    await showSection('History')
    await settle(1500)
    // Select the first commit so the detail pane is populated.
    await page().evaluate(() => {
      const row = document.querySelector(
        '.commit-list .list-item, #commit-list .list-item'
      )
      if (row instanceof HTMLElement) {
        row.click()
      }
    })
    await settle(1200)
    await capture('material-history')
  })

  scene('history-context-actions', async () => {
    await ensureRepository()
    await showSection('History')
    await settle(1200)
    await page().evaluate(() => {
      const row = document.querySelector(
        '.commit-list .list-item, #commit-list .list-item'
      )
      if (row instanceof HTMLElement) {
        row.click()
        row.dispatchEvent(
          new MouseEvent('contextmenu', {
            bubbles: true,
            cancelable: true,
            clientX: row.getBoundingClientRect().left + 120,
            clientY: row.getBoundingClientRect().top + 12,
          })
        )
      }
    })
    await settle(1000)
    await capture('material-history-context-actions')
    await pressEscape(1)
  })

  scene('repositories-sheet', async () => {
    await ensureRepository()
    await page().keyboard.press('Control+t')
    await settle(1000)
    await capture('material-repositories-sheet')
    await pressEscape(1)
  })

  scene('branches-sheet', async () => {
    await ensureRepository()
    await showSection('Branches')
    await settle(1000)
    await capture('material-branches-sheet')
    await pressEscape(1)
  })

  scene('settings', async () => {
    await ensureRepository()
    await page().evaluate(() => {
      const button = document.querySelector('button[aria-label="Settings"]')
      if (button instanceof HTMLElement) {
        button.click()
      }
    })
    await settle(1200)
    await capture('material-settings')
    await pressEscape(1)
  })

  scene('reset-size', async () => {
    await setContentSize(DefaultWidth, DefaultHeight)
    await settle(400)
  })
}
