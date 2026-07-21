import assert from 'node:assert'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, it } from 'node:test'

const setupAction = readFileSync(
  join(process.cwd(), '.github/actions/setup-ci-environment/action.yml'),
  'utf8'
)

describe('CI environment setup', () => {
  it('uses an exact installed-dependency cache and skips cold setup only on a hit', () => {
    assert.match(setupAction, /uses: actions\/cache@v5/)
    assert.match(setupAction, /node_modules\s+app\/node_modules/)
    assert.match(setupAction, /AppData\/Local\/ms-playwright/)
    assert.match(
      setupAction,
      /installed-deps-v4-\$\{\{ runner\.os \}\}-\$\{\{ runner\.arch \}\}-target-/
    )
    assert.doesNotMatch(setupAction, /restore-keys:/)
    assert.match(
      setupAction,
      /Verify installed dependencies before use[\s\S]*?Installed dependency cache is incomplete/
    )
    assert.match(
      setupAction,
      /Install and build dependencies[\s\S]*?cache-hit != 'true'/
    )
    assert.match(setupAction, /cache-dependency-path:[\s\S]*?app\/yarn\.lock/)
    assert.match(setupAction, /actions\/setup-python@v6/)
    assert.match(setupAction, /missing Playwright ffmpeg/)
    assert.match(setupAction, /refusing to save or use this exact cache key/)
    assert.match(
      setupAction,
      /find "\$root"[\s\S]*?-mindepth 2[\s\S]*?-maxdepth 2[\s\S]*?-type f[\s\S]*?-path "\$root\/ffmpeg-\*\/\*"/
    )
    assert.match(setupAction, /-name ffmpeg-linux/)
    assert.match(setupAction, /-name ffmpeg-mac/)
    assert.match(setupAction, /-name ffmpeg-win64\.exe/)
    assert.doesNotMatch(setupAction, /-name ['"]?ffmpeg\*['"]?/)
    assert.match(setupAction, /copilot-win32-\$\{\{ inputs\.arch \}\}/)
  })

  it('pins and retries the cross-compilation Copilot package install', () => {
    assert.match(
      setupAction,
      /PKG_VERSION=\$\(node -p "require\('\.\/app\/node_modules\/@github\/copilot\/package\.json'\)\.version"\)/
    )
    assert.match(setupAction, /"\$\{PKG\}@\$\{PKG_VERSION\}"/)
    assert.match(setupAction, /for attempt in 1 2 3; do/)
    assert.match(setupAction, /after 3 attempts/)
  })
})
