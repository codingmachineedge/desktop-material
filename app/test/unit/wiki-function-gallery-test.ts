import { describe, it } from 'node:test'
import assert from 'node:assert'
import { existsSync, readFileSync, readdirSync } from 'fs'
import { join } from 'path'

const root = process.cwd()
const galleryPath = join(root, 'docs', 'wiki', 'Feature-Gallery.md')
const screenshotDirectory = join(root, 'docs', 'assets', 'screenshots')
const rawImagePrefix =
  'https://raw.githubusercontent.com/codingmachineedge/desktop-material/main/docs/assets/screenshots/'
const canonicalRawImagePrefix =
  'https://raw.githubusercontent.com/Ding-Ding-Projects/desktop-material/main/docs/assets/screenshots/'
const rawImagePrefixes = [rawImagePrefix, canonicalRawImagePrefix]

describe('wiki function screenshot catalog', () => {
  it('assigns every tracked screenshot to exactly one named visual function', () => {
    const gallery = readFileSync(galleryPath, 'utf8')
    const rows = [
      ...gallery.matchAll(/^\| `([^`]+\.png)` \| ([^|]+?) \|$/gm),
    ].map(([, asset, name]) => ({ asset, name: name.trim() }))
    const assets = readdirSync(screenshotDirectory)
      .filter(name => name.endsWith('.png'))
      .sort()

    assert.equal(rows.length, 66)
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
    ]
      .map(([, url]) => url)
      .map(url => {
        const prefix = rawImagePrefixes.find(candidate =>
          url.startsWith(candidate)
        )
        return prefix === undefined ? undefined : url.slice(prefix.length)
      })
      .filter((asset): asset is string => asset !== undefined)

    assert.equal(renderedAssets.length, rowAssets.length)
    assert.equal(new Set(renderedAssets).size, renderedAssets.length)
    assert.deepEqual(renderedAssets.sort(), rowAssets.sort())
    assert.ok(
      gallery.includes(
        `${canonicalRawImagePrefix}material-ollama-model-manager.png`
      )
    )
  })

  it('links the complete catalog from the wiki home and user guide', () => {
    for (const file of ['Home.md', 'User-Guide.md']) {
      const markdown = readFileSync(join(root, 'docs', 'wiki', file), 'utf8')
      assert.match(markdown, /\[Guided Feature Gallery\]\(Feature-Gallery\)/)
    }
  })
})

const submodulesGuidePath = join(root, 'docs', 'wiki', 'Submodules.md')
const illustrationDirectory = join(root, 'docs', 'assets', 'illustrations')
const rawIllustrationPrefix =
  'https://raw.githubusercontent.com/codingmachineedge/desktop-material/main/docs/assets/illustrations/'

describe('wiki submodules guide', () => {
  it('links the beginner submodule guide from the wiki home and user guide', () => {
    for (const file of ['Home.md', 'User-Guide.md']) {
      const markdown = readFileSync(join(root, 'docs', 'wiki', file), 'utf8')
      assert.match(markdown, /\[Submodules\]\(Submodules\)/)
    }
  })

  it('renders every tracked illustration exactly once from raw main', () => {
    const guide = readFileSync(submodulesGuidePath, 'utf8')
    const renderedAssets = [
      ...guide.matchAll(/!\[[^\]]+\]\((https:\/\/[^)]+\.svg)\)/g),
    ]
      .map(([, url]) => url)
      .filter(url => url.startsWith(rawIllustrationPrefix))
      .map(url => url.slice(rawIllustrationPrefix.length))
    const assets = readdirSync(illustrationDirectory)
      .filter(name => name.endsWith('.svg'))
      .sort()

    assert.ok(assets.length > 0, 'expected tracked submodule illustrations')
    assert.equal(new Set(renderedAssets).size, renderedAssets.length)
    assert.deepEqual([...renderedAssets].sort(), assets)
    for (const asset of renderedAssets) {
      assert.ok(existsSync(join(illustrationDirectory, asset)), asset)
    }
  })

  it('reuses the tracked Add Submodule screenshot', () => {
    const guide = readFileSync(submodulesGuidePath, 'utf8')
    assert.ok(guide.includes(`${rawImagePrefix}add-submodule-dialog.png`))
  })
})
