import { describe, it } from 'node:test'
import assert from 'node:assert'
import { existsSync, readFileSync } from 'fs'
import { join } from 'path'

const read = (path: string) => readFileSync(join(process.cwd(), path), 'utf8')

describe('Pages accessibility contracts', () => {
  it('uses a named Material navigation and a keyboard skip route', () => {
    const markup = read('site/index.html')

    assert.match(markup, /class="skip-link" href="#top"/)
    assert.match(markup, /<main id="top" tabindex="-1">/)
    assert.match(
      markup,
      /<nav class="appbar-actions" aria-label="Primary navigation">/
    )
    assert.match(markup, /<section class="hero" aria-labelledby="hero-title">/)
    assert.match(markup, /<h1 class="hero-title" id="hero-title">/)
    assert.match(
      markup,
      /<ul class="material-principles" aria-label="Design principles">/
    )
  })

  it('implements the expressive Material surfaces without losing focus or motion safety', () => {
    const style = read('site/style.css')

    assert.match(style, /--md-sys-shape-expressive:\s*44px;/)
    assert.match(style, /\.hero-surface\s*\{[\s\S]*?border-radius:/)
    assert.match(style, /\.material-principles\s*\{[\s\S]*?display:\s*grid;/)
    assert.match(style, /:where\(a, button\):focus-visible\s*\{/)
    assert.match(
      style,
      /\.cta-card \.btn:focus-visible\s*\{[\s\S]*?var\(--md-sys-color-on-primary\)/
    )
    assert.match(style, /@media \(prefers-reduced-motion: reduce\)/)
  })

  it('publishes the Material welcome, scoped appearance, and adaptive toolbar release', () => {
    const markup = read('site/index.html')

    assert.match(markup, /<h3>Material first run/)
    assert.match(markup, /<h3>Scope-aware appearance/)
    assert.match(markup, /<h3>Adaptive toolbar/)
    assert.match(
      markup,
      /Build &amp; Run moves into More\s+first,[\s\S]*?Commit &amp; Push/
    )
    assert.match(
      markup,
      /dedicated setting, local Git path, and mutable history/
    )
    assert.match(markup, /no monolithic repository Appearance tab/)
    assert.match(markup, /class="material-icon-sprite"/)
    assert.match(markup, /id="icon-palette"/)
    assert.match(markup, /id="theme-icon" href="#icon-dark-mode"/)
    assert.doesNotMatch(markup, /[🎨🧭🗂👥🕔🪟⚙🔔🔍⚡🤖🏢🧰☾☀★▤⚖]/u)
    assert.doesNotMatch(
      markup,
      /<div class="glyph" aria-hidden="true">[^<]+<\/div>/
    )

    for (const source of [
      'docs/assets/screenshots/material-app-identity-workspace.png',
      'docs/assets/screenshots/material-welcome.png',
      'docs/assets/screenshots/material-customization.png',
      'docs/assets/screenshots/material-toolbar-overflow.png',
    ]) {
      assert.ok(
        markup.includes(`href="${source}"`),
        `${source} is missing its full-size link`
      )
      assert.ok(
        markup.includes(`src="${source}"`),
        `${source} is missing its gallery image`
      )
    }
  })

  it('keeps footer headings in sequence after the page-level h2 sections', () => {
    const markup = read('site/index.html')

    assert.doesNotMatch(markup, /<h4\b/)
    assert.match(markup, /<h3>Project<\/h3>/)
    assert.match(markup, /<h3>Upstream<\/h3>/)
  })

  it('publishes the repository-bound GitHub API Explorer evidence', () => {
    const markup = read('site/index.html')
    const source = 'docs/assets/screenshots/material-github-api-explorer.png'

    assert.match(markup, /<h3>\s*GitHub API Explorer/)
    assert.match(markup, /1,206 REST operations/)
    assert.ok(markup.includes(`href="${source}"`))
    assert.ok(markup.includes(`src="${source}"`))
  })

  it('publishes notification bulk actions and non-blocking error evidence', () => {
    const markup = read('site/index.html')

    assert.match(markup, /select-visible bulk actions/)
    assert.match(markup, /Acknowledgement-only errors/)

    for (const source of [
      'docs/assets/screenshots/material-notification-bulk-actions.png',
      'docs/assets/screenshots/material-error-notice.png',
    ]) {
      assert.ok(markup.includes(`href="${source}"`))
      assert.ok(markup.includes(`src="${source}"`))
    }
  })

  it('publishes navigation, History actions, and Tools scroll evidence', () => {
    const markup = read('site/index.html')

    for (const source of [
      'docs/assets/screenshots/material-tab-search.png',
      'docs/assets/screenshots/material-history-context-actions.png',
      'docs/assets/screenshots/material-repository-tools-scroll.png',
    ]) {
      assert.ok(markup.includes(`href="${source}"`))
      assert.ok(markup.includes(`src="${source}"`))
    }
  })

  it('visually distinguishes in-text section links without color alone', () => {
    const style = read('site/style.css')

    assert.match(
      style,
      /\.section-sub a\s*\{[\s\S]*?text-decoration:\s*underline;/
    )
  })

  it('keeps the expanded screenshot gallery lazy, named, and locally valid', () => {
    const markup = read('site/index.html')
    const gallery = markup.match(
      /<div class="gallery-grid">([\s\S]*?)<\/div>\s*<\/div>\s*<\/section>/
    )?.[1]
    assert.ok(gallery, 'Could not find the Pages screenshot gallery')

    const figures = [
      ...gallery.matchAll(/<figure class="shot">([\s\S]*?)<\/figure>/g),
    ]
    const manifest = read('docs/wiki/Feature-Gallery.md')
    const expectedSources = [
      ...manifest.matchAll(/^\| `([^`]+\.png)` \| ([^|]+?) \|$/gm),
    ]
      .map(([, file]) => `docs/assets/screenshots/${file}`)
      .sort()
    assert.equal(expectedSources.length, 66)
    assert.equal(figures.length, expectedSources.length)

    const actualSources = new Array<string>()
    for (const [, figure] of figures) {
      const href = figure.match(/<a\s+[\s\S]*?href="([^"]+)"/)?.[1]
      const source = figure.match(/<img\s+[\s\S]*?src="([^"]+)"/)?.[1]
      const alt = figure.match(/<img\s+[\s\S]*?alt="([^"]+)"/)?.[1]
      assert.ok(href, 'Gallery image is missing its full-size link')
      assert.ok(source, 'Gallery image is missing a source')
      actualSources.push(source)
      assert.equal(href, source, `${source} full-size link does not match`)
      assert.ok(alt?.trim(), `${source} is missing useful alt text`)
      assert.match(figure, /loading="lazy"/)
      assert.match(figure, /target="_blank"/)
      assert.match(figure, /rel="noopener"/)
      assert.ok(existsSync(join(process.cwd(), source)), `${source} is missing`)
    }
    assert.deepEqual(actualSources.sort(), expectedSources)
  })
})
