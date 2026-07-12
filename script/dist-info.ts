import * as Path from 'path'
import * as Fs from 'fs'

import { getProductName, getVersion } from '../app/package-info'
import { join } from 'path'

const productName = getProductName()
const version = getVersion()

const projectRoot = Path.join(__dirname, '..')

export function getDistRoot() {
  return Path.join(projectRoot, 'dist')
}

export function getDistPath() {
  return Path.join(
    getDistRoot(),
    `${getExecutableName()}-${process.platform}-${getDistArchitecture()}`
  )
}

export function getExecutableName() {
  const suffix = process.env.NODE_ENV === 'development' ? '-dev' : ''

  if (process.platform === 'win32') {
    return `${getWindowsIdentifierName()}${suffix}`
  } else if (process.platform === 'linux') {
    return 'desktop'
  } else {
    return productName
  }
}

export function getOSXZipName() {
  return `${productName}-${getDistArchitecture()}.zip`
}

export function getOSXZipPath() {
  return Path.join(getDistPath(), '..', getOSXZipName())
}

export function getWindowsInstallerName() {
  const productName = getExecutableName()
  return `${productName}Setup-${getDistArchitecture()}.msi`
}

export function getWindowsInstallerPath() {
  return Path.join(getDistPath(), '..', 'installer', getWindowsInstallerName())
}

export function getWindowsStandaloneName() {
  const productName = getExecutableName()
  return `${productName}Setup-${getDistArchitecture()}.exe`
}

export function getWindowsStandalonePath() {
  return Path.join(getDistPath(), '..', 'installer', getWindowsStandaloneName())
}

export function getWindowsFullNugetPackageName(
  includeArchitecture: boolean = false
) {
  const architectureInfix = includeArchitecture
    ? `-${getDistArchitecture()}`
    : ''
  return `${getWindowsIdentifierName()}-${version}${architectureInfix}-full.nupkg`
}

export function getWindowsFullNugetPackagePath() {
  return Path.join(
    getDistPath(),
    '..',
    'installer',
    getWindowsFullNugetPackageName()
  )
}

export function getWindowsDeltaNugetPackageName(
  includeArchitecture: boolean = false
) {
  const architectureInfix = includeArchitecture
    ? `-${getDistArchitecture()}`
    : ''
  return `${getWindowsIdentifierName()}-${version}${architectureInfix}-delta.nupkg`
}

export function getWindowsDeltaNugetPackagePath() {
  return Path.join(
    getDistPath(),
    '..',
    'installer',
    getWindowsDeltaNugetPackageName()
  )
}

export function getWindowsIdentifierName() {
  return 'GitHubDesktop'
}

export function getBundleSizes() {
  const outPath = Path.join(projectRoot, 'out')
  return {
    // eslint-disable-next-line no-sync
    rendererBundleSize: Fs.statSync(Path.join(outPath, 'renderer.js')).size,
    // eslint-disable-next-line no-sync
    mainBundleSize: Fs.statSync(Path.join(outPath, 'main.js')).size,
  }
}
export const isPublishable = () =>
  ['production', 'beta', 'test'].includes(getChannel())

export const getChannel = () =>
  process.env.RELEASE_CHANNEL ?? process.env.NODE_ENV ?? 'development'

export function getDistArchitecture(): 'arm64' | 'x64' {
  // If a specific npm_config_arch is set, we use that one instead of the OS arch (to support cross compilation)
  if (
    process.env.npm_config_arch === 'arm64' ||
    process.env.npm_config_arch === 'x64'
  ) {
    return process.env.npm_config_arch
  }

  if (process.arch === 'arm64') {
    return 'arm64'
  }

  // TODO: Check if it's x64 running on an arm64 Windows with IsWow64Process2
  // More info: https://www.rudyhuyn.com/blog/2017/12/13/how-to-detect-that-your-x86-application-runs-on-windows-on-arm/
  // Right now (March 3, 2021) is not very important because support for x64
  // apps on an arm64 Windows is experimental. See:
  // https://blogs.windows.com/windows-insider/2020/12/10/introducing-x64-emulation-in-preview-for-windows-10-on-arm-pcs-to-the-windows-insider-program/

  return 'x64'
}

export function getUpdatesURL() {
  // Desktop Material fork: auto-update from the fork's OWN GitHub releases
  // instead of upstream's Central deployment server. Upstream's endpoint serves
  // the official GitHub Desktop binaries, so a fork build polling it would
  // silently update itself back to upstream and clobber the fork.
  //
  // A build-time DESKTOP_UPDATES_URL still fully overrides the endpoint (for a
  // custom update server, or the DESKTOP_E2E_UPDATES_URL local test server).
  // When it is unset we point Squirrel.Windows at this repo's
  // `releases/latest/download/` folder. GitHub's stable "latest" redirect makes
  // that a fixed URL that never changes per release, and it always resolves to
  // the newest published release's assets — the Squirrel `RELEASES` manifest
  // and the `*-full.nupkg` package, both attached to every release by
  // .github/workflows/build-installers.yml. Squirrel fetches `<url>RELEASES`,
  // reads the latest version, then downloads the referenced nupkg from the same
  // folder. The trailing slash is required so Squirrel appends `RELEASES`
  // rather than replacing the last path segment.
  const forkUpdatesURL = process.env.DESKTOP_UPDATES_URL
  if (forkUpdatesURL !== undefined && forkUpdatesURL.length > 0) {
    return forkUpdatesURL
  }

  // Repository that publishes fork releases. Overridable so a downstream
  // re-fork doesn't have to patch source to retarget its own release feed.
  const repo =
    process.env.DESKTOP_UPDATES_REPO ?? 'codingmachineedge/desktop-material'
  return `https://github.com/${repo}/releases/latest/download/`
}

export function shouldMakeDelta() {
  // Delta packages require a reachable previous `RELEASES` feed at build time —
  // electron-winstaller downloads `remoteReleases` (see script/package.ts) to
  // diff the new package against it. For the fork's per-push GitHub releases we
  // default to full-only packages: this is robust (the very first release has
  // no prior feed to diff against, which would otherwise fail the build) and
  // Squirrel handles a full-only feed fine — it simply downloads the whole
  // package. Opt back in with DESKTOP_MAKE_DELTA=1 once a stable, sequential
  // release history exists.
  if (process.env.DESKTOP_MAKE_DELTA !== '1') {
    return false
  }

  // Only production and beta channels include deltas. Test releases aren't
  // necessarily sequential so deltas wouldn't make sense.
  return ['production', 'beta'].includes(getChannel())
}

/**
 * Path to the directory containing all icon assets for the current release channel.
 */
export function getIconDirectory() {
  const devOrProd = getChannel() === 'development' ? 'dev' : 'prod'
  return join(projectRoot, 'app', 'static', 'logos', devOrProd)
}

export function getChannelFromReleaseBranch(): string {
  const branchName = process.env.GITHUB_HEAD_REF ?? ''

  if (!branchName.includes('releases/')) {
    return 'development'
  }

  if (getVersion().includes('test')) {
    return 'test'
  }

  if (getVersion().includes('beta')) {
    return 'beta'
  }

  return 'production'
}
