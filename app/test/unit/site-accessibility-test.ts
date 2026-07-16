import { describe, it } from 'node:test'
import assert from 'node:assert'
import { existsSync, readFileSync } from 'fs'
import { join } from 'path'

const read = (path: string) => readFileSync(join(process.cwd(), path), 'utf8')

describe('Pages accessibility contracts', () => {
  it('keeps footer headings in sequence after the page-level h2 sections', () => {
    const markup = read('site/index.html')

    assert.doesNotMatch(markup, /<h4\b/)
    assert.match(markup, /<h3>Project<\/h3>/)
    assert.match(markup, /<h3>Upstream<\/h3>/)
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
    assert.ok(
      figures.length >= 40,
      'Pages should expose at least 40 screenshots'
    )

    for (const [, figure] of figures) {
      const source = figure.match(/<img\s+[\s\S]*?src="([^"]+)"/)?.[1]
      const alt = figure.match(/<img\s+[\s\S]*?alt="([^"]+)"/)?.[1]
      assert.ok(source, 'Gallery image is missing a source')
      assert.ok(alt?.trim(), `${source} is missing useful alt text`)
      assert.match(figure, /loading="lazy"/)
      assert.match(figure, /target="_blank"/)
      assert.match(figure, /rel="noopener"/)
      assert.ok(existsSync(join(process.cwd(), source)), `${source} is missing`)
    }
  })
})
