import { describe, it } from 'node:test'
import assert from 'node:assert'
import { existsSync, readFileSync, readdirSync } from 'fs'
import { join } from 'path'

const root = process.cwd()
const galleryPath = join(root, 'docs', 'wiki', 'Feature-Gallery.md')
const screenshotDirectory = join(root, 'docs', 'assets', 'screenshots')
const rawImagePrefix =
  'https://raw.githubusercontent.com/codingmachineedge/desktop-material/main/docs/assets/screenshots/'

describe('wiki function screenshot catalog', () => {
  it('assigns every tracked screenshot to exactly one named visual function', () => {
    const gallery = readFileSync(galleryPath, 'utf8')
    const rows = [
      ...gallery.matchAll(/^\| `([^`]+\.png)` \| ([^|]+?) \|$/gm),
    ].map(([, asset, name]) => ({ asset, name: name.trim() }))
    const assets = readdirSync(screenshotDirectory)
      .filter(name => name.endsWith('.png'))
      .sort()

    assert.equal(rows.length, 63)
    assert.equal(new Set(rows.map(row => row.asset)).size, rows.length)
    assert.equal(new Set(rows.map(row => row.name)).size, rows.length)
    assert.deepEqual(rows.map(row => row.asset).sort(), assets)
    for (const row of rows) {
      assert.ok(existsSync(join(screenshotDirectory, row.asset)), row.asset)
    }
  })

  it('renders one distinct raw-main image for every catalog row', () => {
    const gallery = readFileSync(galleryPath, 'utf8')
    const rowAssets = [
      ...gallery.matchAll(/^\| `([^`]+\.png)` \| ([^|]+?) \|$/gm),
    ].map(([, asset]) => asset)
    const renderedAssets = [
      ...gallery.matchAll(/!\[[^\]]+\]\((https:\/\/[^)]+\.png)\)/g),
    ].map(([, url]) => {
      assert.ok(url.startsWith(rawImagePrefix), url)
      return url.slice(rawImagePrefix.length)
    })

    assert.equal(renderedAssets.length, rowAssets.length)
    assert.equal(new Set(renderedAssets).size, renderedAssets.length)
    assert.deepEqual(renderedAssets.sort(), rowAssets.sort())
  })

  it('links the complete catalog from the wiki home and user guide', () => {
    for (const file of ['Home.md', 'User-Guide.md']) {
      const markdown = readFileSync(join(root, 'docs', 'wiki', file), 'utf8')
      assert.match(markdown, /\[Guided Feature Gallery\]\(Feature-Gallery\)/)
    }
  })
})
