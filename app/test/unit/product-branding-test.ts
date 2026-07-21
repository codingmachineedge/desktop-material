import assert from 'node:assert'
import { describe, it } from 'node:test'

import { DefaultAppDisplayName } from '../../src/models/app-identity'
import { AppDisplayName } from '../../app-info'
import { productName } from '../../package.json'

/**
 * Branding invariants for the fork.
 *
 * The fork carries two intentionally *different* names:
 *
 *  - The user-visible display name (`Desktop Material`), surfaced to the
 *    renderer as `__APP_NAME__` and read back by `getName()` in the About
 *    dialog and other display strings.
 *  - The on-disk product identity (`productName` in `app/package.json`), which
 *    `script/build.ts` copies into the packaged `package.json`. That value
 *    becomes Electron's `app.getName()` and therefore the userData directory
 *    and the macOS `.app` bundle name.
 *
 * These tests pin both so that (a) no upstream "GitHub Desktop" string can leak
 * into the renderer, and (b) nobody flips `productName` — which would silently
 * orphan every existing install's settings and profile data — without also
 * shipping a data migration.
 */
describe('product name branding', () => {
  it('exposes the canonical Desktop Material display name to the renderer', () => {
    assert.equal(AppDisplayName, 'Desktop Material')
    // The build constant and the canonical model constant must not drift; they
    // live in separate files only because `app-info.ts` is compiled in a
    // Node-only ts-node context that cannot import the React-typed model.
    assert.equal(AppDisplayName, DefaultAppDisplayName)
  })

  it('injects the display name as __APP_NAME__ for tests, matching production', () => {
    // `getName()` simply returns `__APP_NAME__`; assert the injected global is
    // the rebranded display name rather than the on-disk product name.
    assert.equal(__APP_NAME__, DefaultAppDisplayName)
  })

  it('never surfaces the upstream product name as the display name', () => {
    assert.ok(!AppDisplayName.includes('GitHub Desktop'))
    assert.ok(!__APP_NAME__.includes('GitHub Desktop'))
  })

  it('keeps the on-disk product identity pinned to avoid orphaning user data', () => {
    // Renaming `productName` moves Electron's userData directory
    // (`%APPDATA%\GitHub Desktop`, `~/Library/Application Support/GitHub
    // Desktop`) and the macOS bundle, stranding existing users' data. It stays
    // pinned until an explicit migration exists. This guard documents intent —
    // change it only alongside that migration.
    assert.equal(productName, 'GitHub Desktop')
  })
})
