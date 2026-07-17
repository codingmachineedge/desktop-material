import { readdir, readFile } from 'fs/promises'
import * as Path from 'path'
import {
  BuildRunEcosystem,
  IBuildProfile,
  ICommand,
  IRepoFileProbe,
  IToolchainCheck,
} from './types'

/**
 * Deterministic build-profile detection.
 *
 * {@link detectProfiles} is pure: it consumes an {@link IRepoFileProbe} and
 * returns ranked profiles, so it is fully unit-testable without disk access.
 * {@link probeRepository} is the thin, bounded-walk adapter that builds a probe
 * from a real working tree.
 */

/** Maximum number of profiles surfaced to the UI. */
const MAX_PROFILES = 12

/** Walk limits for {@link probeRepository}. */
const MAX_WALK_DEPTH = 4
const MAX_WALK_ENTRIES = 4000
const WALK_SKIP_DIRS = new Set([
  '.git',
  'node_modules',
  'vendor',
  'target',
  'bin',
  'obj',
  'dist',
  'out',
  '.venv',
  '__pycache__',
  '.dart_tool',
  '_build',
  '.bundle',
  '.gradle',
  '.elixir_ls',
])

/** Files whose text the detector is allowed to read (size-capped on disk). */
const READ_TEXT_ALLOW_LIST = new Set([
  'package.json',
  'deno.json',
  'deno.jsonc',
  'pyproject.toml',
  'setup.py',
  'setup.cfg',
  'requirements.txt',
  'Pipfile',
  'Pipfile.lock',
  'poetry.lock',
  'environment.yml',
  'environment.yaml',
  'Makefile',
  'go.mod',
  'composer.json',
  'Gemfile',
  'Package.swift',
  'pubspec.yaml',
  'mix.exs',
  'build.sbt',
  'stack.yaml',
  'cabal.project',
  'build.zig',
])
const MAX_READ_TEXT_BYTES = 256 * 1024

/** Manifest basenames that mark a directory as a candidate project root. */
const MANIFEST_MARKERS = [
  'package.json',
  'deno.json',
  'deno.jsonc',
  'Cargo.toml',
  'go.mod',
  'pyproject.toml',
  'setup.py',
  'setup.cfg',
  'requirements.txt',
  'Pipfile',
  'Pipfile.lock',
  'poetry.lock',
  'environment.yml',
  'environment.yaml',
  'CMakeLists.txt',
  'Makefile',
  'pom.xml',
  'build.gradle',
  'build.gradle.kts',
  'composer.json',
  'Gemfile',
  'Package.swift',
  'pubspec.yaml',
  'mix.exs',
  'build.sbt',
  'stack.yaml',
  'cabal.project',
  'build.zig',
  'main.py',
  'app.py',
  'manage.py',
  'Dockerfile',
  'docker-compose.yml',
  'docker-compose.yaml',
  'compose.yml',
  'compose.yaml',
]

/** Penalty applied to any profile discovered below the repository root. */
const NESTED_PENALTY = 4

/** Cap on candidate directories to keep detection bounded. */
const MAX_CANDIDATE_DIRS = 24

function cmd(
  exe: string,
  args: ReadonlyArray<string>,
  label?: string
): ICommand {
  return { exe, args, label: label ?? `${exe} ${args.join(' ')}`.trim() }
}

/**
 * A probe scoped to a sub-directory: paths are resolved relative to `dir`, and
 * `sampleFiles` only contains entries below it (with the prefix stripped).
 */
interface IScopedProbe extends IRepoFileProbe {
  readonly dir: string
}

function scopeProbe(probe: IRepoFileProbe, dir: string): IScopedProbe {
  if (dir === '') {
    return { ...probe, dir }
  }
  const prefix = `${dir}/`
  return {
    dir,
    platform: probe.platform,
    exists: p => probe.exists(`${prefix}${p}`),
    readText: p => probe.readText(`${prefix}${p}`),
    sampleFiles: probe.sampleFiles
      .filter(f => f.startsWith(prefix))
      .map(f => f.slice(prefix.length)),
  }
}

/** Top-level files in the scoped directory whose name ends with `suffix`. */
function globFiles(probe: IScopedProbe, suffix: string): ReadonlyArray<string> {
  return probe.sampleFiles.filter(
    f => f.endsWith(suffix) && !f.slice(0, -suffix.length).includes('/')
  )
}

/** The basename of a file with its extension stripped (e.g. `App.csproj`→`App`). */
function projectName(file: string): string {
  const slash = file.lastIndexOf('/')
  const base = slash === -1 ? file : file.slice(slash + 1)
  const dot = base.lastIndexOf('.')
  return dot === -1 ? base : base.slice(0, dot)
}

/**
 * A detector's output before the wrapper assigns id / cwd / nested penalty.
 * An optional `subId` disambiguates multiple profiles a single detector may
 * emit for the same directory (e.g. one per .NET project).
 */
type DetectionResult = Omit<IBuildProfile, 'id' | 'cwd'> & {
  readonly subId?: string
}

type Detector = (
  probe: IScopedProbe
) => DetectionResult | ReadonlyArray<DetectionResult> | null

// ── Node ───────────────────────────────────────────────────────────────────

type NodePackageManager = 'npm' | 'yarn' | 'pnpm' | 'bun'

function resolvePackageManager(probe: IScopedProbe): {
  pm: NodePackageManager
  hasLock: boolean
} {
  if (probe.exists('yarn.lock')) {
    return { pm: 'yarn', hasLock: true }
  }
  if (probe.exists('pnpm-lock.yaml')) {
    return { pm: 'pnpm', hasLock: true }
  }
  if (probe.exists('bun.lockb') || probe.exists('bun.lock')) {
    return { pm: 'bun', hasLock: true }
  }
  if (probe.exists('package-lock.json')) {
    return { pm: 'npm', hasLock: true }
  }
  const packageManager = readPackageManagerField(probe)
  if (packageManager !== null) {
    return { pm: packageManager, hasLock: false }
  }
  return { pm: 'npm', hasLock: false }
}

function readPackageManagerField(
  probe: IScopedProbe
): NodePackageManager | null {
  const raw = probe.readText('package.json')
  if (raw == null) {
    return null
  }
  try {
    const packageManager = (JSON.parse(raw) as { packageManager?: unknown })
      .packageManager
    if (typeof packageManager !== 'string') {
      return null
    }
    const name = packageManager.split('@', 1)[0]
    return name === 'npm' ||
      name === 'yarn' ||
      name === 'pnpm' ||
      name === 'bun'
      ? name
      : null
  } catch {
    return null
  }
}

function parsePackageJson(
  probe: IScopedProbe
): { scripts: Record<string, string>; deps: Set<string> } | null {
  const raw = probe.readText('package.json')
  if (raw == null) {
    return null
  }
  try {
    const json = JSON.parse(raw) as {
      scripts?: Record<string, string>
      dependencies?: Record<string, string>
      devDependencies?: Record<string, string>
    }
    const deps = new Set<string>([
      ...Object.keys(json.dependencies ?? {}),
      ...Object.keys(json.devDependencies ?? {}),
    ])
    return { scripts: json.scripts ?? {}, deps }
  } catch {
    return { scripts: {}, deps: new Set() }
  }
}

const detectNode: Detector = probe => {
  if (!probe.exists('package.json')) {
    return null
  }
  const parsed = parsePackageJson(probe)
  const scripts = parsed?.scripts ?? {}
  const deps = parsed?.deps ?? new Set<string>()
  const { pm, hasLock } = resolvePackageManager(probe)

  const reasons: string[] = ['package.json found']
  let score = 10

  if (hasLock) {
    score += 3
    reasons.push(`${pm} lockfile`)
  }

  const installArgs = pm === 'npm' && hasLock ? ['ci'] : ['install']
  const install: ICommand[] = [cmd(pm, installArgs)]

  const build: ICommand[] = []
  if (typeof scripts.build === 'string') {
    build.push(cmd(pm, ['run', 'build'], `${pm} run build`))
    score += 2
    reasons.push('build script')
  }

  const hasElectron = deps.has('electron')
  const hasTauri = probe.exists('src-tauri/Cargo.toml')
  const runOrder = hasElectron
    ? ['electron', 'dev', 'start', 'serve']
    : ['dev', 'start', 'serve']
  const runScript = runOrder.find(name => typeof scripts[name] === 'string')

  const run: ICommand[] = []
  if (runScript) {
    run.push(cmd(pm, ['run', runScript], `${pm} run ${runScript}`))
    score += 2
    reasons.push(`${runScript} script`)
  }

  if (hasElectron) {
    reasons.push('electron app')
  }
  const extraIgnores = ['dist/', 'build/', '.next/', 'out/', 'coverage/']
  if (hasTauri) {
    reasons.push('tauri app')
    extraIgnores.push('src-tauri/target/')
  }

  const label = hasTauri
    ? 'Tauri app'
    : hasElectron
    ? 'Electron app'
    : `Node (${pm})`

  const toolchainCheck: IToolchainCheck = {
    cmd: cmd(pm, ['--version']),
    missingHint:
      pm === 'npm'
        ? 'npm was not found on your PATH. Install Node.js (includes npm) from https://nodejs.org/.'
        : `${pm} was not found on your PATH. Install it, or install Node.js from https://nodejs.org/.`,
  }

  return {
    ecosystem: 'node',
    label,
    toolIcon: 'server',
    install,
    build: build.length > 0 ? build : undefined,
    run: run.length > 0 ? run : undefined,
    toolchainCheck,
    needsElevation: false,
    gitignoreTemplateId: 'node',
    extraIgnores,
    score,
    reasons,
  }
}

// ── Deno ─────────────────────────────────────────────────────────────────────

function readDenoTasks(probe: IScopedProbe): Set<string> {
  const raw = probe.readText('deno.json') ?? probe.readText('deno.jsonc')
  if (raw == null) {
    return new Set()
  }
  try {
    const tasks = (JSON.parse(raw) as { tasks?: Record<string, unknown> }).tasks
    return new Set(
      Object.keys(tasks ?? {}).filter(key => typeof tasks?.[key] === 'string')
    )
  } catch {
    // JSONC is intentionally handled conservatively: task names are still
    // discoverable without executing or evaluating project configuration.
    return new Set(
      [...raw.matchAll(/"(build|dev|start|serve)"\s*:/g)].map(match => match[1])
    )
  }
}

const detectDeno: Detector = probe => {
  if (!probe.exists('deno.json') && !probe.exists('deno.jsonc')) {
    return null
  }
  const tasks = readDenoTasks(probe)
  const reasons: string[] = [
    probe.exists('deno.json') ? 'deno.json found' : 'deno.jsonc found',
  ]
  let score = 10
  const build: ICommand[] = []
  if (tasks.has('build')) {
    build.push(cmd('deno', ['task', 'build']))
    score += 2
    reasons.push('build task')
  }

  const runTask = ['dev', 'start', 'serve'].find(task => tasks.has(task))
  const run: ICommand[] | undefined = runTask
    ? [cmd('deno', ['task', runTask])]
    : probe.exists('main.ts')
    ? [cmd('deno', ['run', '--allow-all', 'main.ts'])]
    : probe.exists('main.js')
    ? [cmd('deno', ['run', '--allow-all', 'main.js'])]
    : undefined
  if (runTask) {
    score += 2
    reasons.push(`${runTask} task`)
  } else if (run !== undefined) {
    score += 2
    reasons.push('entrypoint')
  }

  return {
    ecosystem: 'deno',
    label: 'Deno',
    toolIcon: 'code',
    build: build.length > 0 ? build : undefined,
    run,
    toolchainCheck: {
      cmd: cmd('deno', ['--version']),
      missingHint:
        'deno was not found on your PATH. Install Deno from https://deno.com/runtime.',
    },
    needsElevation: false,
    gitignoreTemplateId: 'node',
    extraIgnores: ['.deno/', 'coverage/'],
    score,
    reasons,
  }
}

// ── Rust ─────────────────────────────────────────────────────────────────────

const detectRust: Detector = probe => {
  if (!probe.exists('Cargo.toml')) {
    return null
  }
  const reasons: string[] = ['Cargo.toml found']
  let score = 10
  if (probe.exists('Cargo.lock')) {
    score += 3
    reasons.push('Cargo.lock')
  }

  const hasBin = probe.exists('src/main.rs')
  const hasLib = probe.exists('src/lib.rs')
  const libOnly = !hasBin && hasLib

  const run: ICommand[] | undefined = libOnly
    ? undefined
    : [cmd('cargo', ['run'])]
  if (libOnly) {
    reasons.push('library crate (no run target)')
  }

  return {
    ecosystem: 'rust',
    label: 'Rust',
    toolIcon: 'gear',
    build: [cmd('cargo', ['build'])],
    run,
    toolchainCheck: {
      cmd: cmd('cargo', ['--version']),
      missingHint:
        'cargo was not found on your PATH. Install Rust from https://rustup.rs/.',
    },
    needsElevation: false,
    gitignoreTemplateId: 'rust',
    extraIgnores: ['target/'],
    score,
    reasons,
  }
}

// ── Go ───────────────────────────────────────────────────────────────────────

const detectGo: Detector = probe => {
  if (!probe.exists('go.mod')) {
    return null
  }
  const reasons: string[] = ['go.mod found']
  let score = 10
  if (probe.exists('go.sum')) {
    score += 3
    reasons.push('go.sum')
  }
  return {
    ecosystem: 'go',
    label: 'Go',
    toolIcon: 'codeSquare',
    install: [cmd('go', ['mod', 'download'])],
    build: [cmd('go', ['build', './...'])],
    run: [cmd('go', ['run', '.'])],
    toolchainCheck: {
      cmd: cmd('go', ['version']),
      missingHint:
        'go was not found on your PATH. Install Go from https://go.dev/dl/.',
    },
    needsElevation: false,
    gitignoreTemplateId: 'go',
    extraIgnores: ['bin/'],
    score,
    reasons,
  }
}

// ── .NET ─────────────────────────────────────────────────────────────────────

const dotnetToolchainCheck: IToolchainCheck = {
  cmd: cmd('dotnet', ['--version']),
  missingHint:
    'dotnet was not found on your PATH. Install the .NET SDK from https://dotnet.microsoft.com/download.',
}

/** A single .NET project (.csproj) or solution (.sln) as a build result. */
function dotnetResult(
  file: string,
  kind: 'project' | 'solution',
  multiple: boolean,
  hasSln: boolean
): DetectionResult {
  const name = projectName(file)
  const label = multiple ? `.NET · ${name}` : '.NET'
  // A project is runnable; a bare solution builds but has no single entrypoint.
  const run: ICommand[] | undefined =
    kind === 'project'
      ? [cmd('dotnet', ['run', '--project', file], `dotnet run (${name})`)]
      : undefined
  const reasons =
    kind === 'project'
      ? [`project ${file}`, ...(hasSln ? ['solution file'] : [])]
      : [`solution ${file}`]
  return {
    ecosystem: 'dotnet',
    subId: multiple ? name : undefined,
    label,
    toolIcon: 'container',
    install: [cmd('dotnet', ['restore', file], `dotnet restore (${name})`)],
    build: [cmd('dotnet', ['build', file], `dotnet build (${name})`)],
    run,
    toolchainCheck: dotnetToolchainCheck,
    needsElevation: false,
    gitignoreTemplateId: 'visualstudio',
    extraIgnores: ['bin/', 'obj/'],
    // A solution file is a stronger "this is the thing to build" signal.
    score: 10 + (kind === 'solution' || hasSln ? 3 : 0),
    reasons,
  }
}

const detectDotnet: Detector = probe => {
  const csprojs = globFiles(probe, '.csproj')
  const slns = globFiles(probe, '.sln')
  if (csprojs.length === 0 && slns.length === 0) {
    return null
  }

  // Prefer runnable projects: when any .csproj is present, emit one profile per
  // project so the user picks which to run instead of the detector guessing.
  // With only solution files, emit one build-only profile per solution.
  if (csprojs.length > 0) {
    const multiple = csprojs.length > 1
    const hasSln = slns.length > 0
    return csprojs.map(f => dotnetResult(f, 'project', multiple, hasSln))
  }

  const multiple = slns.length > 1
  return slns.map(f => dotnetResult(f, 'solution', multiple, true))
}

// ── Python ───────────────────────────────────────────────────────────────────

const detectPython: Detector = probe => {
  const hasPyproject = probe.exists('pyproject.toml')
  const hasSetupPy = probe.exists('setup.py')
  const hasSetupCfg = probe.exists('setup.cfg')
  const hasRequirements = probe.exists('requirements.txt')
  const hasPipfile = probe.exists('Pipfile')
  const hasPoetryLock = probe.exists('poetry.lock')
  const hasEnvironmentFile =
    probe.exists('environment.yml') || probe.exists('environment.yaml')
  const hasPythonManifest =
    hasPyproject ||
    hasSetupPy ||
    hasSetupCfg ||
    hasRequirements ||
    hasPipfile ||
    hasPoetryLock ||
    hasEnvironmentFile
  const entrypoint = probe.exists('manage.py')
    ? 'manage.py'
    : probe.exists('main.py')
    ? 'main.py'
    : probe.exists('app.py')
    ? 'app.py'
    : null
  if (!hasPythonManifest && entrypoint === null) {
    return null
  }
  const win = probe.platform === 'win32'
  const reasons: string[] = []
  let score = 10

  const sysPython = win ? 'python' : 'python3'
  const pipExe = win ? '.venv\\Scripts\\pip.exe' : '.venv/bin/pip'
  const venvPython = win ? '.venv\\Scripts\\python.exe' : '.venv/bin/python'

  const install: ICommand[] = [
    cmd(sysPython, ['-m', 'venv', '.venv'], 'create .venv'),
  ]
  if (hasRequirements) {
    reasons.push('requirements.txt found')
    install.push(cmd(pipExe, ['install', '-r', 'requirements.txt']))
  } else if (hasPipfile) {
    reasons.push('Pipfile found')
    install.push(cmd('pipenv', ['install']))
  } else if (hasPoetryLock) {
    reasons.push('poetry.lock found')
    install.push(cmd('poetry', ['install']))
  } else if (hasPyproject || hasSetupPy || hasSetupCfg) {
    reasons.push(
      hasPyproject
        ? 'pyproject.toml found'
        : hasSetupPy
        ? 'setup.py found'
        : 'setup.cfg found'
    )
    install.push(cmd(pipExe, ['install', '-e', '.']))
    score += 3
  } else {
    reasons.push(
      hasEnvironmentFile ? 'environment file found' : 'Python entrypoint found'
    )
  }

  // Resolve a run command from the strongest available signal.
  let run: ICommand[] | undefined
  const runPython = hasPipfile
    ? 'pipenv'
    : hasPoetryLock
    ? 'poetry'
    : venvPython
  if (entrypoint === 'manage.py') {
    run =
      runPython === venvPython
        ? [
            cmd(
              runPython,
              ['manage.py', 'runserver'],
              'python manage.py runserver'
            ),
          ]
        : [cmd(runPython, ['run', 'python', 'manage.py', 'runserver'])]
    score += 2
    reasons.push('Django manage.py')
  } else {
    const requirementsText = probe.readText('requirements.txt') ?? ''
    const pyprojectText = probe.readText('pyproject.toml') ?? ''
    const mentionsUvicorn = /uvicorn/i.test(requirementsText + pyprojectText)
    if (mentionsUvicorn) {
      run =
        runPython === venvPython
          ? [
              cmd(
                runPython,
                ['-m', 'uvicorn', 'main:app', '--reload'],
                'python -m uvicorn main:app'
              ),
            ]
          : [
              cmd(runPython, [
                'run',
                'python',
                '-m',
                'uvicorn',
                'main:app',
                '--reload',
              ]),
            ]
      score += 2
      reasons.push('uvicorn app')
    } else if (entrypoint !== null) {
      run =
        runPython === venvPython
          ? [cmd(runPython, [entrypoint], `python ${entrypoint}`)]
          : [cmd(runPython, ['run', 'python', entrypoint])]
      score += 2
      reasons.push(`${entrypoint} entrypoint`)
    }
  }

  return {
    ecosystem: 'python',
    label: 'Python',
    toolIcon: 'code',
    install,
    run,
    toolchainCheck: {
      cmd:
        hasPipfile || hasPoetryLock
          ? cmd(hasPipfile ? 'pipenv' : 'poetry', ['--version'])
          : cmd(sysPython, ['--version']),
      missingHint:
        'python was not found on your PATH. Install Python from https://python.org/downloads/.',
    },
    needsElevation: false,
    gitignoreTemplateId: 'python',
    extraIgnores: ['.venv/', '__pycache__/', '*.egg-info/', 'dist/', 'build/'],
    score,
    reasons,
  }
}

// ── PHP / Ruby / Swift / Dart / Elixir ───────────────────────────────────────

function readManifestScripts(
  probe: IScopedProbe,
  file: string
): Record<string, string> {
  const raw = probe.readText(file)
  if (raw == null) {
    return {}
  }
  try {
    const scripts = (JSON.parse(raw) as { scripts?: unknown }).scripts
    return typeof scripts === 'object' && scripts !== null
      ? Object.fromEntries(
          Object.entries(scripts).filter(
            (entry): entry is [string, string] => typeof entry[1] === 'string'
          )
        )
      : {}
  } catch {
    return {}
  }
}

const detectPhp: Detector = probe => {
  if (!probe.exists('composer.json')) {
    return null
  }
  const scripts = readManifestScripts(probe, 'composer.json')
  const reasons: string[] = ['composer.json found']
  let score = 10
  const build: ICommand[] = []
  if (typeof scripts.build === 'string') {
    build.push(cmd('composer', ['run', 'build']))
    score += 2
    reasons.push('build script')
  }

  const script = ['dev', 'start', 'serve'].find(
    name => typeof scripts[name] === 'string'
  )
  const run: ICommand[] | undefined = script
    ? [cmd('composer', ['run', script])]
    : probe.exists('artisan')
    ? [cmd('php', ['artisan', 'serve'])]
    : probe.exists('public/index.php')
    ? [cmd('php', ['-S', 'localhost:8000', '-t', 'public'])]
    : probe.exists('index.php')
    ? [cmd('php', ['-S', 'localhost:8000'])]
    : undefined
  if (script) {
    score += 2
    reasons.push(`${script} script`)
  } else if (run !== undefined) {
    score += 2
    reasons.push('PHP entrypoint')
  }

  return {
    ecosystem: 'php',
    label: 'PHP',
    toolIcon: 'code',
    install: [cmd('composer', ['install'])],
    build: build.length > 0 ? build : undefined,
    run,
    toolchainCheck: {
      cmd: cmd('php', ['--version']),
      missingHint:
        'php was not found on your PATH. Install PHP and Composer from https://getcomposer.org/.',
    },
    needsElevation: false,
    gitignoreTemplateId: 'composer',
    extraIgnores: ['vendor/', 'var/cache/'],
    score,
    reasons,
  }
}

const detectRuby: Detector = probe => {
  if (!probe.exists('Gemfile')) {
    return null
  }
  const reasons: string[] = ['Gemfile found']
  let score = 10
  let run: ICommand[] | undefined
  if (probe.exists('bin/rails')) {
    run = [cmd('bundle', ['exec', 'rails', 'server'])]
    score += 2
    reasons.push('Rails entrypoint')
  } else if (probe.exists('config.ru')) {
    run = [cmd('bundle', ['exec', 'rackup'])]
    score += 2
    reasons.push('Rack entrypoint')
  } else {
    const entrypoint = probe.exists('main.rb')
      ? 'main.rb'
      : probe.exists('app.rb')
      ? 'app.rb'
      : null
    if (entrypoint !== null) {
      run = [cmd('bundle', ['exec', 'ruby', entrypoint])]
      score += 2
      reasons.push(`${entrypoint} entrypoint`)
    }
  }

  return {
    ecosystem: 'ruby',
    label: 'Ruby',
    toolIcon: 'code',
    install: [cmd('bundle', ['install'])],
    run,
    toolchainCheck: {
      cmd: cmd('bundle', ['--version']),
      missingHint:
        'Bundler was not found on your PATH. Install Ruby and Bundler from https://www.ruby-lang.org/en/documentation/installation/.',
    },
    needsElevation: false,
    gitignoreTemplateId: 'ruby',
    extraIgnores: ['.bundle/', 'vendor/bundle/'],
    score,
    reasons,
  }
}

const detectSwift: Detector = probe => {
  if (!probe.exists('Package.swift')) {
    return null
  }
  const hasExecutable = probe.sampleFiles.some(
    file => file.startsWith('Sources/') && file.endsWith('/main.swift')
  )
  const reasons: string[] = ['Package.swift found']
  if (hasExecutable) {
    reasons.push('executable target')
  }
  return {
    ecosystem: 'swift',
    label: 'Swift Package',
    toolIcon: 'gear',
    install: [cmd('swift', ['package', 'resolve'])],
    build: [cmd('swift', ['build'])],
    run: hasExecutable ? [cmd('swift', ['run'])] : undefined,
    toolchainCheck: {
      cmd: cmd('swift', ['--version']),
      missingHint:
        'swift was not found on your PATH. Install the Swift toolchain from https://www.swift.org/install/.',
    },
    needsElevation: false,
    gitignoreTemplateId: '',
    extraIgnores: ['.build/'],
    score: 10 + (hasExecutable ? 2 : 0),
    reasons,
  }
}

const detectDart: Detector = probe => {
  if (!probe.exists('pubspec.yaml')) {
    return null
  }
  const text = probe.readText('pubspec.yaml') ?? ''
  const isFlutter = /(^|\n)\s*sdk:\s*flutter\b/i.test(text)
  const exe = isFlutter ? 'flutter' : 'dart'
  const reasons: string[] = ['pubspec.yaml found']
  if (isFlutter) {
    reasons.push('Flutter SDK dependency')
  }
  const hasEntrypoint =
    probe.exists('lib/main.dart') ||
    probe.exists('bin/main.dart') ||
    probe.sampleFiles.some(file => /^(bin|tool)\/[^/]+\.dart$/.test(file))
  return {
    ecosystem: 'dart',
    label: isFlutter ? 'Flutter' : 'Dart',
    toolIcon: 'code',
    install: [cmd(exe, ['pub', 'get'])],
    run: hasEntrypoint ? [cmd(exe, ['run'])] : undefined,
    toolchainCheck: {
      cmd: cmd(exe, ['--version']),
      missingHint: `${exe} was not found on your PATH. Install it from https://dart.dev/get-dart.`,
    },
    needsElevation: false,
    gitignoreTemplateId: isFlutter ? 'flutter' : 'dart',
    extraIgnores: ['.dart_tool/', 'build/'],
    score: 10 + (isFlutter ? 2 : 0) + (hasEntrypoint ? 2 : 0),
    reasons,
  }
}

const detectElixir: Detector = probe => {
  if (!probe.exists('mix.exs')) {
    return null
  }
  const mixText = probe.readText('mix.exs') ?? ''
  const isPhoenix =
    /phoenix/i.test(mixText) ||
    probe.sampleFiles.some(file => file.includes('_web/'))
  return {
    ecosystem: 'elixir',
    label: isPhoenix ? 'Elixir / Phoenix' : 'Elixir',
    toolIcon: 'code',
    install: [cmd('mix', ['deps.get'])],
    build: [cmd('mix', ['compile'])],
    run: [cmd('mix', isPhoenix ? ['phx.server'] : ['run', '--no-halt'])],
    toolchainCheck: {
      cmd: cmd('mix', ['--version']),
      missingHint:
        'mix was not found on your PATH. Install Elixir and Erlang from https://elixir-lang.org/install.html.',
    },
    needsElevation: false,
    gitignoreTemplateId: '',
    extraIgnores: ['_build/', 'deps/', '.elixir_ls/'],
    score: 12,
    reasons: ['mix.exs found', ...(isPhoenix ? ['Phoenix application'] : [])],
  }
}

// ── Scala / Haskell / Zig ────────────────────────────────────────────────────

const detectScala: Detector = probe => {
  if (!probe.exists('build.sbt')) {
    return null
  }
  const hasMain = probe.sampleFiles.some(
    file => file.startsWith('src/main/scala/') && /\.scala$/.test(file)
  )
  return {
    ecosystem: 'scala',
    label: 'Scala / SBT',
    toolIcon: 'cpu',
    install: [cmd('sbt', ['update'])],
    build: [cmd('sbt', ['compile'])],
    run: hasMain ? [cmd('sbt', ['run'])] : undefined,
    toolchainCheck: {
      cmd: cmd('sbt', ['--version']),
      missingHint:
        'sbt was not found on your PATH. Install SBT and a JDK from https://www.scala-lang.org/download/.',
    },
    needsElevation: false,
    gitignoreTemplateId: 'java',
    extraIgnores: ['target/', '.bsp/'],
    score: 10 + (hasMain ? 2 : 0),
    reasons: ['build.sbt found', ...(hasMain ? ['Scala source'] : [])],
  }
}

const detectHaskell: Detector = probe => {
  const cabalFiles = globFiles(probe, '.cabal')
  const hasStack = probe.exists('stack.yaml')
  const hasCabal = probe.exists('cabal.project') || cabalFiles.length > 0
  if (!hasStack && !hasCabal) {
    return null
  }
  const exe = hasStack ? 'stack' : 'cabal'
  const manifestText = hasStack
    ? probe.readText('stack.yaml') ?? ''
    : cabalFiles.map(file => probe.readText(file) ?? '').join('\n')
  const hasExecutable = /(^|\n)\s*executable\b/i.test(manifestText)
  return {
    ecosystem: 'haskell',
    label: 'Haskell',
    toolIcon: 'code',
    install: hasStack
      ? [cmd('stack', ['build', '--only-dependencies'])]
      : [cmd('cabal', ['update'])],
    build: [cmd(exe, ['build'])],
    run: hasExecutable ? [cmd(exe, ['run'])] : undefined,
    toolchainCheck: {
      cmd: cmd(exe, ['--version']),
      missingHint:
        'A Haskell toolchain was not found. Install GHCup from https://www.haskell.org/ghcup/.',
    },
    needsElevation: false,
    gitignoreTemplateId: '',
    extraIgnores: ['.stack-work/', 'dist-newstyle/'],
    score: 10 + (hasExecutable ? 2 : 0),
    reasons: [
      hasStack ? 'stack.yaml found' : 'Cabal manifest found',
      ...(hasExecutable ? ['executable target'] : []),
    ],
  }
}

const detectZig: Detector = probe => {
  if (!probe.exists('build.zig')) {
    return null
  }
  const text = probe.readText('build.zig') ?? ''
  const hasRunStep = /addRunArtifact|addRun\s*\(/.test(text)
  return {
    ecosystem: 'zig',
    label: 'Zig',
    toolIcon: 'gear',
    build: [cmd('zig', ['build'])],
    run: hasRunStep ? [cmd('zig', ['build', 'run'])] : undefined,
    toolchainCheck: {
      cmd: cmd('zig', ['version']),
      missingHint:
        'zig was not found on your PATH. Install Zig from https://ziglang.org/download/.',
    },
    needsElevation: false,
    gitignoreTemplateId: '',
    extraIgnores: ['zig-cache/', 'zig-out/'],
    score: 10 + (hasRunStep ? 2 : 0),
    reasons: ['build.zig found', ...(hasRunStep ? ['run step'] : [])],
  }
}

// ── Java (Gradle / Maven) ────────────────────────────────────────────────────

const detectJava: Detector = probe => {
  const win = probe.platform === 'win32'
  const hasGradleWrapper =
    probe.exists('gradlew') || probe.exists('gradlew.bat')
  const hasMavenWrapper = probe.exists('mvnw') || probe.exists('mvnw.cmd')
  const hasGradle =
    probe.exists('build.gradle') || probe.exists('build.gradle.kts')
  const hasMaven = probe.exists('pom.xml')

  if (!hasGradleWrapper && !hasMavenWrapper && !hasGradle && !hasMaven) {
    return null
  }

  const reasons: string[] = []
  let score = 10
  let build: ICommand[]
  let run: ICommand[] | undefined
  let toolchainCheck: IToolchainCheck

  if (hasGradleWrapper) {
    score += 3
    reasons.push('Gradle wrapper')
    const gradlew = win ? 'gradlew.bat' : './gradlew'
    build = [cmd(gradlew, ['build'])]
    run = [cmd(gradlew, ['run'])]
    toolchainCheck = {
      cmd: cmd(gradlew, ['--version']),
      missingHint:
        'The Gradle wrapper could not run. A JDK is required — install one from https://adoptium.net/.',
    }
  } else if (hasMavenWrapper) {
    score += 3
    reasons.push('Maven wrapper')
    const mvnw = win ? 'mvnw.cmd' : './mvnw'
    build = [cmd(mvnw, ['-q', 'package'])]
    run = undefined
    toolchainCheck = {
      cmd: cmd(mvnw, ['-v']),
      missingHint:
        'The Maven wrapper could not run. A JDK is required — install one from https://adoptium.net/.',
    }
  } else if (hasGradle) {
    reasons.push('Gradle build')
    build = [cmd('gradle', ['build'])]
    run = [cmd('gradle', ['run'])]
    toolchainCheck = {
      cmd: cmd('gradle', ['--version']),
      missingHint:
        'gradle was not found on your PATH. Install Gradle from https://gradle.org/install/.',
    }
  } else {
    reasons.push('Maven build')
    build = [cmd('mvn', ['-q', 'package'])]
    run = undefined
    toolchainCheck = {
      cmd: cmd('mvn', ['-v']),
      missingHint:
        'mvn was not found on your PATH. Install Maven from https://maven.apache.org/.',
    }
  }

  return {
    ecosystem: 'java',
    label: 'Java',
    toolIcon: 'cpu',
    build,
    run,
    toolchainCheck,
    needsElevation: false,
    gitignoreTemplateId: 'java',
    extraIgnores: ['build/', 'target/', '.gradle/'],
    score,
    reasons,
  }
}

// ── CMake ────────────────────────────────────────────────────────────────────

const detectCmake: Detector = probe => {
  if (!probe.exists('CMakeLists.txt')) {
    return null
  }
  return {
    ecosystem: 'cmake',
    label: 'CMake',
    toolIcon: 'tools',
    build: [cmd('cmake', ['-B', 'build']), cmd('cmake', ['--build', 'build'])],
    run: undefined,
    toolchainCheck: {
      cmd: cmd('cmake', ['--version']),
      missingHint:
        'cmake was not found on your PATH. Install CMake from https://cmake.org/download/.',
    },
    needsElevation: false,
    gitignoreTemplateId: '',
    extraIgnores: ['build/'],
    score: 10,
    reasons: ['CMakeLists.txt found'],
  }
}

// ── Make (generic fallback) ──────────────────────────────────────────────────

const detectMake: Detector = probe => {
  if (!probe.exists('Makefile')) {
    return null
  }
  const text = probe.readText('Makefile') ?? ''
  const hasRunTarget = /^run\s*:/m.test(text)
  const run: ICommand[] | undefined = hasRunTarget
    ? [cmd('make', ['run'])]
    : undefined
  const reasons: string[] = ['Makefile found']
  if (hasRunTarget) {
    reasons.push('run: target')
  }
  return {
    ecosystem: 'make',
    label: 'Make',
    toolIcon: 'terminal',
    build: [cmd('make', [])],
    run,
    toolchainCheck: {
      cmd: cmd('make', ['--version']),
      missingHint:
        'make was not found on your PATH. Install build tools for your platform (e.g. MSYS2 on Windows).',
    },
    needsElevation: false,
    gitignoreTemplateId: '',
    extraIgnores: ['build/', 'bin/'],
    score: 10,
    reasons,
  }
}

// ── Docker ──────────────────────────────────────────────────────────────────

const COMPOSE_FILES = [
  'docker-compose.yml',
  'docker-compose.yaml',
  'compose.yml',
  'compose.yaml',
]

const dockerToolchainCheck: IToolchainCheck = {
  cmd: cmd('docker', ['--version']),
  missingHint:
    'docker was not found on your PATH. Install Docker Desktop from https://www.docker.com/products/docker-desktop/ and make sure it is running.',
}

const detectDocker: Detector = probe => {
  const hasDockerfile = probe.exists('Dockerfile')
  const composeFile = COMPOSE_FILES.find(f => probe.exists(f))
  if (!hasDockerfile && composeFile === undefined) {
    return null
  }

  const results: DetectionResult[] = []

  if (composeFile !== undefined) {
    const reasons = [`${composeFile} found`]
    let score = 10
    if (hasDockerfile) {
      score += 1
      reasons.push('Dockerfile found')
    }
    results.push({
      ecosystem: 'docker',
      label: 'Docker Compose',
      toolIcon: 'container',
      subId: 'compose',
      build: [cmd('docker', ['compose', 'build'])],
      run: [cmd('docker', ['compose', 'up'])],
      toolchainCheck: dockerToolchainCheck,
      needsElevation: false,
      gitignoreTemplateId: '',
      extraIgnores: [],
      score,
      reasons,
    })
  }

  if (hasDockerfile) {
    results.push({
      ecosystem: 'docker',
      label: 'Docker image',
      toolIcon: 'container',
      subId: 'image',
      build: [cmd('docker', ['build', '.'])],
      run: undefined,
      toolchainCheck: dockerToolchainCheck,
      needsElevation: false,
      gitignoreTemplateId: '',
      extraIgnores: [],
      // When a compose file also exists it orchestrates the same Dockerfile;
      // rank the plain image build below it.
      score: composeFile !== undefined ? 8 : 10,
      reasons: ['Dockerfile found'],
    })
  }

  return results
}

/** All detectors. `detectMake` is a generic fallback, suppressed elsewhere. */
const DETECTORS: ReadonlyArray<Detector> = [
  detectNode,
  detectDeno,
  detectRust,
  detectGo,
  detectDotnet,
  detectPython,
  detectPhp,
  detectRuby,
  detectSwift,
  detectDart,
  detectElixir,
  detectScala,
  detectHaskell,
  detectZig,
  detectJava,
  detectCmake,
  detectDocker,
  detectMake,
]

/** Collect candidate project-root directories (root plus nested manifests). */
function collectCandidateDirs(probe: IRepoFileProbe): ReadonlyArray<string> {
  const dirs = new Set<string>([''])
  for (const file of probe.sampleFiles) {
    const slash = file.lastIndexOf('/')
    if (slash === -1) {
      continue
    }
    const base = file.slice(slash + 1)
    const isMarker =
      MANIFEST_MARKERS.includes(base) ||
      base.endsWith('.csproj') ||
      base.endsWith('.sln') ||
      base.endsWith('.cabal')
    if (isMarker) {
      dirs.add(file.slice(0, slash))
    }
    if (dirs.size >= MAX_CANDIDATE_DIRS) {
      break
    }
  }
  return [...dirs]
}

function makeId(
  ecosystem: BuildRunEcosystem,
  dir: string,
  subId?: string
): string {
  const base = dir === '' ? ecosystem : `${ecosystem}:${dir}`
  return subId ? `${base}:${subId}` : base
}

/**
 * Detect ranked build profiles from a repository probe. Pure and
 * deterministic: results are sorted by score descending then label ascending,
 * only positive-scoring profiles are returned, and the list is capped at
 * {@link MAX_PROFILES}.
 */
export function detectProfiles(
  probe: IRepoFileProbe
): ReadonlyArray<IBuildProfile> {
  const profiles: IBuildProfile[] = []

  for (const dir of collectCandidateDirs(probe)) {
    const scoped = scopeProbe(probe, dir)
    const dirResults: DetectionResult[] = []
    for (const detector of DETECTORS) {
      const result = detector(scoped)
      if (result === null) {
        continue
      }
      const results = Array.isArray(result) ? result : [result]
      for (const r of results) {
        dirResults.push(r)
      }
    }

    // `make` is a generic fallback: drop it when a real ecosystem matched
    // here. Docker does not count — a Dockerfile packages the project without
    // replacing whatever the Makefile natively builds.
    const suppressesMake = dirResults.some(
      r => r.ecosystem !== 'make' && r.ecosystem !== 'docker'
    )
    const effective = suppressesMake
      ? dirResults.filter(r => r.ecosystem !== 'make')
      : dirResults

    for (const result of effective) {
      const nested = dir !== ''
      const score = nested ? result.score - NESTED_PENALTY : result.score
      if (score <= 0) {
        continue
      }
      const { subId, ...rest } = result
      profiles.push({
        ...rest,
        id: makeId(result.ecosystem, dir, subId),
        cwd: dir,
        score,
        reasons: nested
          ? [...result.reasons, `nested in ${dir}/ (−${NESTED_PENALTY})`]
          : result.reasons,
      })
    }
  }

  profiles.sort((a, b) => {
    if (b.score !== a.score) {
      return b.score - a.score
    }
    return a.label.localeCompare(b.label)
  })

  return profiles.slice(0, MAX_PROFILES)
}

/**
 * Build a bounded probe of a repository's working tree. Skips heavy build /
 * dependency directories, caps the number of entries scanned, and only reads
 * the text of small allow-listed manifest files.
 */
export async function probeRepository(
  repoPath: string,
  platform: NodeJS.Platform = process.platform
): Promise<IRepoFileProbe> {
  const paths = new Set<string>()
  const sampleFiles: string[] = []
  const texts = new Map<string, string | null>()
  let entryCount = 0

  const queue: Array<{ dir: string; depth: number; rel: string }> = [
    { dir: repoPath, depth: 0, rel: '' },
  ]

  while (queue.length > 0 && entryCount < MAX_WALK_ENTRIES) {
    const { dir, depth, rel } = queue.shift()!

    let entries
    try {
      entries = await readdir(dir, { withFileTypes: true })
    } catch {
      continue
    }

    for (const entry of entries) {
      if (entryCount >= MAX_WALK_ENTRIES) {
        break
      }
      entryCount++

      const relPath = rel ? `${rel}/${entry.name}` : entry.name
      paths.add(relPath)

      if (entry.isDirectory()) {
        if (!WALK_SKIP_DIRS.has(entry.name) && depth < MAX_WALK_DEPTH) {
          queue.push({
            dir: Path.join(dir, entry.name),
            depth: depth + 1,
            rel: relPath,
          })
        }
      } else if (entry.isFile()) {
        sampleFiles.push(relPath)
        if (READ_TEXT_ALLOW_LIST.has(entry.name) && !texts.has(relPath)) {
          try {
            const buffer = await readFile(Path.join(dir, entry.name))
            texts.set(
              relPath,
              buffer.length > MAX_READ_TEXT_BYTES
                ? null
                : buffer.toString('utf8')
            )
          } catch {
            texts.set(relPath, null)
          }
        }
      }
    }
  }

  return {
    exists: relativePath => paths.has(relativePath),
    readText: relativePath => texts.get(relativePath) ?? null,
    sampleFiles,
    platform,
  }
}
