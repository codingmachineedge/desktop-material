import { getSHA } from './git-info'
import { getUpdatesURL, getChannel } from '../script/dist-info'
import { version } from './package.json'

/**
 * The user-visible product name baked into the renderer as `__APP_NAME__`
 * (surfaced by `getName()` in the About dialog and other display strings).
 *
 * This is deliberately NOT `package.json`'s `productName`. `productName` is the
 * fork's *on-disk* identity: `script/build.ts` copies it into the packaged
 * `package.json`, which becomes Electron's `app.getName()` and therefore the
 * userData directory (`%APPDATA%\GitHub Desktop`, `~/Library/Application
 * Support/GitHub Desktop`) and the macOS `.app` bundle name. Renaming it would
 * silently orphan every existing install's settings/profile data, so it stays
 * pinned to `GitHub Desktop` until an explicit data migration exists.
 *
 * The value must stay in sync with `DefaultAppDisplayName` in
 * `app/src/models/app-identity.ts` (the canonical display name). It is kept as a
 * standalone literal rather than imported because this module is evaluated by
 * ts-node under `script/tsconfig.json` (`types: ['node']`, no DOM/React lib) to
 * build the webpack `DefinePlugin` replacements; importing `app-identity.ts`,
 * which references the `React.CSSProperties` type, would break that compile.
 * The pairing is enforced by `app/test/unit/product-branding-test.ts`.
 */
export const AppDisplayName = 'Desktop Material'

const devClientId = '3a723b10ac5575cc5bb9'
const devClientSecret = '22c34d87789a365981ed921352a7b9a8c3f69d54'

const channel = getChannel()

const s = JSON.stringify

const optionalStringReplacement = (value: string | undefined) =>
  value === undefined || value.length === 0 ? 'undefined' : s(value)

export function getReplacements() {
  const isDevBuild = channel === 'development'

  return {
    __OAUTH_CLIENT_ID__: s(process.env.DESKTOP_OAUTH_CLIENT_ID || devClientId),
    __OAUTH_SECRET__: s(
      process.env.DESKTOP_OAUTH_CLIENT_SECRET || devClientSecret
    ),
    __DARWIN__: process.platform === 'darwin',
    __WIN32__: process.platform === 'win32',
    __LINUX__: process.platform === 'linux',
    __APP_NAME__: s(AppDisplayName),
    __APP_VERSION__: s(version),
    __DEV__: isDevBuild,
    __DEV_SECRETS__: isDevBuild || !process.env.DESKTOP_OAUTH_CLIENT_SECRET,
    __RELEASE_CHANNEL__: s(channel),
    __UPDATES_URL__: s(process.env.DESKTOP_E2E_UPDATES_URL ?? getUpdatesURL()),
    __ERROR_REPORTING_ENDPOINT__: optionalStringReplacement(
      process.env.DESKTOP_ERROR_REPORTING_ENDPOINT
    ),
    __NON_FATAL_ERROR_REPORTING_ENDPOINT__: optionalStringReplacement(
      process.env.DESKTOP_NON_FATAL_ERROR_REPORTING_ENDPOINT
    ),
    __SHA__: s(getSHA()),
    'process.platform': s(process.platform),
    'process.env.NODE_ENV': s(process.env.NODE_ENV || 'development'),
    'process.env.TEST_ENV': s(process.env.TEST_ENV),
  }
}
