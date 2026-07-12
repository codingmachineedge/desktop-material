import { describe, it } from 'node:test'
import assert from 'node:assert'
import { sanitizeSVG } from '../../src/ui/diff/image-diffs/svg-sanitizer'

describe('SVG sanitizer', () => {
  it('removes active content and external resource references', () => {
    const result = sanitizeSVG(`
      <svg xmlns="http://www.w3.org/2000/svg" onload="alert(1)">
        <script>alert(1)</script>
        <style>@import url(https://example.com/a.css)</style>
        <foreignObject><iframe src="https://example.com" /></foreignObject>
        <image href="https://example.com/tracker.png" />
        <circle style="fill: url(https://example.com/fill)" onclick="alert(1)" />
      </svg>
    `)

    assert.doesNotMatch(result, /script|foreignObject|iframe|onload|onclick/i)
    assert.doesNotMatch(result, /https:\/\/example\.com/i)
  })

  it('keeps inert shapes, fragment references, and embedded raster images', () => {
    const result = sanitizeSVG(`
      <svg xmlns="http://www.w3.org/2000/svg">
        <defs><linearGradient id="g"><stop offset="1" /></linearGradient></defs>
        <circle fill="url(#g)" />
        <image href="data:image/png;base64,AA==" />
      </svg>
    `)

    assert.match(result, /<circle/)
    assert.match(result, /url\(#g\)/)
    assert.match(result, /data:image\/png;base64,AA==/)
  })
})
