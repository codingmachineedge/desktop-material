import { BuildRunEcosystem, ICommand } from './types'

/**
 * Pure toolchain auto-install mapping.
 *
 * When a profile's toolchain probe fails (e.g. `node`, `cargo` or `dotnet` is
 * not on PATH) the runner can offer to install the missing tool instead of just
 * printing a hint. {@link planToolchainInstall} maps the missing executable /
 * ecosystem to a concrete, argv-encoded install plan:
 *
 *   - the five SDK ecosystems install via `winget` (Windows) behind a single
 *     UAC prompt (`needsElevation: true`);
 *   - `yarn` / `pnpm` are provisioned with `corepack enable`, which ships with
 *     Node and does not require elevation.
 *
 * The function is pure and platform-parameterised so it is fully unit-testable
 * and carries no Node/Electron dependencies. It returns `null` when there is no
 * safe, known install path (unknown tool, or a non-Windows host, where `winget`
 * is unavailable).
 */

/** A single install step, echoed and executed by the runner. */
export interface IToolchainInstallStep {
  /** The argv-encoded command to run. */
  readonly command: ICommand
  /** Human-readable tool name for the "Installing …" panel line. */
  readonly toolLabel: string
  /** Whether this step must run elevated (single UAC via the elevated runner). */
  readonly needsElevation: boolean
}

/** An ordered install plan produced from a missing toolchain. */
export interface IToolchainInstallPlan {
  /** Steps in execution order; elevated steps are batched into one UAC prompt. */
  readonly steps: ReadonlyArray<IToolchainInstallStep>
}

function cmd(
  exe: string,
  args: ReadonlyArray<string>,
  label?: string
): ICommand {
  return { exe, args, label: label ?? `${exe} ${args.join(' ')}`.trim() }
}

/** A silent, non-interactive `winget install <id>` from the winget source. */
function winget(id: string): ICommand {
  return cmd(
    'winget',
    [
      'install',
      '--id',
      id,
      '-e',
      '--source',
      'winget',
      '--accept-package-agreements',
      '--accept-source-agreements',
    ],
    `winget install ${id}`
  )
}

/** Reduce an executable reference to a bare, lower-cased, extension-free name. */
function normalizeExe(exe: string): string {
  let e = exe.toLowerCase().replace(/\\/g, '/')
  const slash = e.lastIndexOf('/')
  if (slash !== -1) {
    e = e.slice(slash + 1)
  }
  return e.replace(/\.(exe|cmd|bat|ps1)$/, '')
}

/** The winget package id + display name for an SDK ecosystem, if known. */
function wingetPackage(
  ecosystem: BuildRunEcosystem,
  exe: string
): { id: string; label: string } | null {
  switch (exe) {
    case 'node':
    case 'npm':
    case 'npx':
      return { id: 'OpenJS.NodeJS', label: 'Node.js' }
    case 'bun':
      return { id: 'Oven-sh.Bun', label: 'Bun' }
    case 'python':
    case 'python3':
    case 'py':
    case 'pip':
    case 'pip3':
      return { id: 'Python.Python.3.12', label: 'Python 3.12' }
    case 'go':
      return { id: 'GoLang.Go', label: 'Go' }
    case 'cargo':
    case 'rustc':
    case 'rustup':
      return { id: 'Rustlang.Rustup', label: 'Rust (rustup)' }
    case 'dotnet':
      return { id: 'Microsoft.DotNet.SDK.8', label: '.NET SDK 8' }
    default:
      break
  }

  // Fall back to the ecosystem when the executable name is unrecognised (for
  // example a project-scoped wrapper), so the common case still resolves.
  switch (ecosystem) {
    case 'node':
      return { id: 'OpenJS.NodeJS', label: 'Node.js' }
    case 'python':
      return { id: 'Python.Python.3.12', label: 'Python 3.12' }
    case 'go':
      return { id: 'GoLang.Go', label: 'Go' }
    case 'rust':
      return { id: 'Rustlang.Rustup', label: 'Rust (rustup)' }
    case 'dotnet':
      return { id: 'Microsoft.DotNet.SDK.8', label: '.NET SDK 8' }
    default:
      return null
  }
}

/**
 * Plan how to install the tool a failed toolchain probe was looking for.
 *
 * `exe` is the missing executable (e.g. the resolved package manager for Node),
 * `ecosystem` the profile's ecosystem, and `platform` the host. Returns an
 * ordered {@link IToolchainInstallPlan}, or `null` when no known, safe install
 * path exists — including every non-Windows host, where `winget` is absent.
 */
export function planToolchainInstall(
  ecosystem: BuildRunEcosystem,
  exe: string,
  platform: NodeJS.Platform
): IToolchainInstallPlan | null {
  if (platform !== 'win32') {
    return null
  }

  const name = normalizeExe(exe)

  // Yarn / pnpm ship through Corepack, which is bundled with Node and needs no
  // elevation. (Node itself must already be present for Corepack to exist.)
  if (name === 'yarn' || name === 'pnpm') {
    return {
      steps: [
        {
          command: cmd('corepack', ['enable'], 'corepack enable'),
          toolLabel: name === 'yarn' ? 'Yarn (via Corepack)' : 'pnpm (via Corepack)',
          needsElevation: false,
        },
      ],
    }
  }

  const pkg = wingetPackage(ecosystem, name)
  if (pkg === null) {
    return null
  }

  return {
    steps: [
      {
        command: winget(pkg.id),
        toolLabel: pkg.label,
        needsElevation: true,
      },
    ],
  }
}
