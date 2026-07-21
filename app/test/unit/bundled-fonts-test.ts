import { createHash } from 'crypto'
import { readFileSync } from 'fs'
import { join } from 'path'
import assert from 'node:assert'
import { describe, it } from 'node:test'

interface IResponseProvenance {
  readonly url: string
  readonly status: number
  readonly contentType: string
  readonly contentLength: number
  readonly sha256: string
}

interface IFontAsset {
  readonly id: string
  readonly relativePath: string
  readonly bytes: number
  readonly sha256: string
  readonly licenseId: string
  readonly cssRequest: {
    readonly url: string
    readonly status: number
    readonly contentType: string
    readonly bytes: number
    readonly sha256: string
  }
  readonly source: IResponseProvenance
  readonly requestedAxes?: Record<string, ReadonlyArray<number>>
  readonly requestedIconNameCount?: number
  readonly requestedIconNames?: ReadonlyArray<string>
}

interface IFontLicense {
  readonly id: string
  readonly spdx: string
  readonly upstreamUrl: string
  readonly upstreamResponse: {
    readonly status: number
    readonly bytes: number
    readonly sha256: string
  }
  readonly checkedInPath: string
  readonly checkedInBytes: number
  readonly checkedInSha256: string
}

interface IFontManifest {
  readonly schemaVersion: number
  readonly acquisition: {
    readonly method: string
    readonly transformations: string
  }
  readonly licenses: ReadonlyArray<IFontLicense>
  readonly assets: ReadonlyArray<IFontAsset>
}

const root = process.cwd()
const manifestPath = join(
  root,
  'app',
  'styles',
  'fonts',
  'font-assets-manifest.json'
)
const manifest = JSON.parse(readFileSync(manifestPath, 'utf8')) as IFontManifest

const sha256 = (contents: Buffer) =>
  createHash('sha256').update(contents).digest('hex')

const canonicalLfTextBytes = (contents: Buffer) =>
  Buffer.from(contents.toString('utf8').replace(/\r\n/g, '\n'), 'utf8')

const expectedAssets = new Map<
  string,
  { readonly bytes: number; readonly sha256: string }
>([
  [
    'roboto-latin-normal-400-700',
    {
      bytes: 43136,
      sha256:
        '1404ca348bd75ef836f4dd8b6f2cc719458642d1237c368296b2fc652dca47dc',
    },
  ],
  [
    'roboto-mono-latin-normal-400-500',
    {
      bytes: 32796,
      sha256:
        'b81cd55177300649be8f95b3b747d721ce607e8ed2856e25bd0c630cfd631faf',
    },
  ],
  [
    'roboto-serif-latin-normal-400-600',
    {
      bytes: 66104,
      sha256:
        'a32deb82e55d4bcb083e09dbb4da3198011ce0e9f919877179e8c2bca23a9042',
    },
  ],
  [
    'roboto-serif-latin-italic-400-600',
    {
      bytes: 72952,
      sha256:
        '14dd8073dcd6e0ce9034ddb9976a29e9d29d3526aff60aa2867b66887c4299fd',
    },
  ],
  [
    'material-symbols-rounded-prototype-98',
    {
      bytes: 85756,
      sha256:
        'e834a2ac93cbdfbdbcf64c144196dfb2cfdb2f605cd5a9700c03f59d68e0674e',
    },
  ],
])

const expectedLicenses = new Map<
  string,
  {
    readonly bytes: number
    readonly sha256: string
    readonly spdx: string
  }
>([
  [
    'roboto-ofl-1.1',
    {
      bytes: 4394,
      sha256:
        '061402327a96aadb0bfb694a960ed289ecd38d383e396243831ab81feb109c41',
      spdx: 'OFL-1.1',
    },
  ],
  [
    'roboto-mono-ofl-1.1',
    {
      bytes: 4395,
      sha256:
        '50ab8dd54680d3473f649c9db86fece88434d097c7834475c1c72d2f8c429215',
      spdx: 'OFL-1.1',
    },
  ],
  [
    'roboto-serif-ofl-1.1',
    {
      bytes: 4396,
      sha256:
        '807add8aba3b132ed3bc40938f1ed4b79f615dcda41d1ca19e8c794b8fd87f81',
      spdx: 'OFL-1.1',
    },
  ],
  [
    'material-symbols-apache-2.0',
    {
      bytes: 11358,
      sha256:
        'cfc7749b96f63bd31c3c42b5c471bf756814053e847c10f3eb003417bc523d30',
      spdx: 'Apache-2.0',
    },
  ],
])

const expectedIconNames =
  'account_circle,account_tree,add,alt_route,alternate_email,anchor,arrow_upward,auto_awesome,autoplay,backspace,bolt,book_2,build,build_circle,call_split,cancel,category,check,check_circle,circle,close,cloud_done,cloud_download,code,commit,content_copy,crop_square,dark_mode,database,delete,deployed_code,difference,do_not_disturb_on,edit,error,expand_more,extension,filter_list,flag,fork_right,format_align_center,format_align_left,format_align_right,format_bold,format_italic,format_underlined,group_add,handyman,history,join_inner,key,keyboard_arrow_down,library_add_check,light_mode,live_help,lock,low_priority,manage_history,mark_email_read,menu_book,merge,monitoring,notifications,notifications_off,open_in_new,package_2,palette,person_add,play_arrow,progress_activity,public,redo,remove,repeat,replay,rocket_launch,schedule,school,search,search_off,security,sell,settings,stacks,star,sync,sync_problem,task_alt,terminal,text_format,tune,undo,unfold_more,visibility,warning,waving_hand,zoom_in,zoom_out'.split(
    ','
  )

describe('bundled Desktop Material fonts', () => {
  it('pins every official WOFF2 byte-for-byte', () => {
    assert.equal(manifest.schemaVersion, 1)
    assert.equal(manifest.assets.length, expectedAssets.size)
    assert.match(manifest.acquisition.method, /Official Google Fonts CSS v2/)
    assert.match(manifest.acquisition.transformations, /^None\./)

    for (const asset of manifest.assets) {
      const expected = expectedAssets.get(asset.id)
      assert.ok(expected !== undefined, `Unexpected asset ${asset.id}`)
      const contents = readFileSync(join(root, asset.relativePath))

      assert.equal(contents.subarray(0, 4).toString('ascii'), 'wOF2')
      assert.equal(contents.length, expected.bytes)
      assert.equal(sha256(contents), expected.sha256)
      assert.equal(asset.bytes, expected.bytes)
      assert.equal(asset.sha256, expected.sha256)
      assert.equal(asset.source.status, 200)
      assert.equal(asset.source.contentType, 'font/woff2')
      assert.equal(asset.source.contentLength, expected.bytes)
      assert.equal(asset.source.sha256, expected.sha256)
      assert.match(asset.source.url, /^https:\/\/fonts\.gstatic\.com\//)
      assert.equal(asset.cssRequest.status, 200)
      assert.equal(asset.cssRequest.contentType, 'text/css; charset=utf-8')
      assert.match(
        asset.cssRequest.url,
        /^https:\/\/fonts\.googleapis\.com\/css2\?/
      )
      assert.match(asset.cssRequest.sha256, /^[a-f0-9]{64}$/)
      assert.ok(asset.cssRequest.bytes > 0)
    }
  })

  it('pins the exact 98-name official Material Symbols request and axes', () => {
    const symbols = manifest.assets.find(
      asset => asset.id === 'material-symbols-rounded-prototype-98'
    )
    assert.ok(symbols !== undefined)
    assert.equal(expectedIconNames.length, 98)
    assert.equal(new Set(expectedIconNames).size, 98)
    assert.deepEqual([...expectedIconNames].sort(), expectedIconNames)
    assert.equal(symbols.requestedIconNameCount, 98)
    assert.deepEqual(symbols.requestedIconNames, expectedIconNames)
    assert.match(
      symbols.cssRequest.url,
      new RegExp(`[?&]icon_names=${expectedIconNames.join(',')}&display=swap$`)
    )
    assert.deepEqual(symbols.requestedAxes, {
      opsz: [20, 48],
      wght: [100, 700],
      FILL: [0, 1],
      GRAD: [0, 0],
    })
  })

  it('ships the exact upstream licenses with checked-in hashes', () => {
    assert.equal(manifest.licenses.length, expectedLicenses.size)
    const knownLicenseIds = new Set(
      manifest.licenses.map(license => license.id)
    )

    for (const asset of manifest.assets) {
      assert.ok(knownLicenseIds.has(asset.licenseId))
    }
    for (const license of manifest.licenses) {
      const expected = expectedLicenses.get(license.id)
      assert.ok(expected !== undefined, `Unexpected license ${license.id}`)
      const contents = canonicalLfTextBytes(
        readFileSync(join(root, license.checkedInPath))
      )

      assert.equal(contents.length, expected.bytes)
      assert.equal(sha256(contents), expected.sha256)
      assert.equal(license.checkedInBytes, expected.bytes)
      assert.equal(license.checkedInSha256, expected.sha256)
      assert.equal(license.spdx, expected.spdx)
      assert.equal(license.upstreamResponse.status, 200)
      assert.match(license.upstreamResponse.sha256, /^[a-f0-9]{64}$/)
      assert.match(
        license.upstreamUrl,
        /^https:\/\/raw\.githubusercontent\.com\/google\//
      )
    }
  })

  it('loads local faces before Material tokens and emits them outside static', () => {
    const desktop = readFileSync(
      join(root, 'app', 'styles', 'desktop.scss'),
      'utf8'
    )
    const fonts = readFileSync(
      join(root, 'app', 'styles', '_fonts.scss'),
      'utf8'
    )
    const material = readFileSync(
      join(root, 'app', 'styles', '_material.scss'),
      'utf8'
    )
    const webpack = readFileSync(join(root, 'app', 'webpack.common.ts'), 'utf8')

    assert.ok(desktop.indexOf("@import 'fonts';") > 0)
    assert.ok(
      desktop.indexOf("@import 'fonts';") <
        desktop.indexOf("@import 'material';")
    )
    assert.equal((fonts.match(/@font-face/g) ?? []).length, 5)
    assert.match(
      fonts,
      /font-family: 'Material Symbols Rounded';[^]*?font-display: block;/
    )
    assert.doesNotMatch(fonts, /https?:\/\//)
    for (const asset of manifest.assets) {
      assert.match(fonts, new RegExp(asset.relativePath.split('/').pop()!))
    }
    assert.match(material, /--font-family-monospace: 'Roboto Mono', Consolas,/)
    assert.match(webpack, /test: \/\\\.woff2\$\/i/)
    assert.match(webpack, /type: 'asset\/resource'/)
    assert.match(webpack, /filename: 'fonts\/\[name\]\[ext\]'/)
    assert.doesNotMatch(webpack, /filename: 'static\/fonts/)
  })
})
